import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../../../generated/prisma/client';
import { errorCode, logger, open } from '../../../platform';
import type { UnitOfWork } from '../../../platform';
import { READY_EVERY_MS, READY_TTL_MS, type DispatchSettings, type ProviderTarget } from './dispatch-policy';
import type { BuiltAdapters, OpenedCredential } from './provider-adapters';
import type { RoutingProviderGateway } from './routing-gateway';

// The worker's side of D18 (ADR 0019): the only reader of a stored credential, and the readiness loop that keeps
// the worker's adapters true to what is stored and writes its attestation. Slice R.5: from `src/provider-dispatch.ts`
// (domain code at the source root) to the providers' dispatch folder; the attestation runs in the unit of work's
// transaction, with the same statements in the same order.

const log = logger('ProviderDispatch');

/** Whether this deployment may build adapters at all: dispatch on, coherent settings, a target, a name, a provider named. */
function mayBuild(settings: DispatchSettings): settings is DispatchSettings & { target: ProviderTarget; deployment: string } {
  return settings.on && settings.problems.length === 0 && settings.target !== null && settings.deployment !== null && settings.adapters.length > 0;
}

/**
 * The opened credentials of the providers this deployment may build adapters for, as they are stored now (ADR
 * 0019, D18), each with its generation. Only the worker calls this: it is the one place a stored credential is
 * opened. Nothing is read unless dispatch is on, the settings hold together and a target is stated. A credential
 * that does not open (the key changed, the value is damaged) is remembered as unreadable and throws when asked
 * for, so no adapter is built with it; one that is not stored answers null. Neither the value nor the cipher's
 * error is logged.
 */
export async function readCredentials(prisma: PrismaClient, settings: DispatchSettings): Promise<(providerCode: string, target: ProviderTarget) => OpenedCredential | null> {
  const opened = new Map<string, OpenedCredential | Error>();
  if (mayBuild(settings)) {
    const rows = await prisma.providerCredential.findMany({ where: { target: settings.target, provider: { code: { in: [...settings.adapters] } } }, select: { sealedValue: true, generation: true, target: true, provider: { select: { code: true } } } });
    for (const row of rows) {
      try {
        const value = open(row.sealedValue);
        opened.set(`${row.provider.code}:${row.target}`, value === '' ? new Error('empty') : { value, generation: row.generation });
      } catch {
        opened.set(`${row.provider.code}:${row.target}`, new Error('unreadable'));
      }
    }
  }
  return (providerCode, target) => {
    const found = opened.get(`${providerCode}:${target}`);
    if (found instanceof Error) throw new Error('a provider credential could not be opened');
    return found ?? null;
  };
}

/** The generation of each named provider's stored credential for the deployment's target. No value is read. */
async function storedGenerations(prisma: PrismaClient, settings: DispatchSettings & { target: ProviderTarget }): Promise<string> {
  const rows = await prisma.providerCredential.findMany({ where: { target: settings.target, provider: { code: { in: [...settings.adapters] } } }, select: { generation: true, provider: { select: { code: true } } } });
  return rows.map((row) => `${row.provider.code}:${row.generation}`).sort().join(',');
}

/** How old a worker's row may be before any worker's round removes it: well past the time it is believed for. */
const STALE_AFTER_MS = 10 * READY_TTL_MS;

/**
 * This worker's attestation, and its adapters kept true to what is stored (ADR 0019, D18). Each round, on a timer:
 *
 * 1. **Rebuild.** When a credential was written since the adapters were built (its generation moved, or one
 *    appeared), every adapter is built again from what is stored now (`rebuild`) and the gateway is handed the
 *    new set. An adapter built from a replaced credential is never kept.
 * 2. **Attest.** For each adapter it holds, the worker writes **its own row** (`ProviderWorkerAttestation`, by
 *    its `workerId`): this deployment, this target, the generation of the credential the adapter was built from,
 *    and the time **by the database's clock** (`now()`). The provider's row is locked first and the stored
 *    generation read under the lock, so a worker that still holds a replaced credential writes nothing, and what
 *    it wrote before is removed: it cannot bring back what the replacement withdrew. It never writes or removes
 *    another worker's row, except rows long past belief (a worker that was killed), which any round clears.
 *
 * The API opens the dispatch route only on such a row, fresh by the database's clock. A worker with no adapter
 * writes nothing. Stopping removes this worker's rows and nobody else's: another worker of the deployment keeps
 * the route open. Answers `stop`, and `round` for a caller that does not wait for the timer.
 */
export function startReadiness(
  uow: UnitOfWork, settings: DispatchSettings, gateway: RoutingProviderGateway, rebuild: () => Promise<BuiltAdapters>, workerId: string = randomUUID(), everyMs: number = READY_EVERY_MS,
): { stop: () => Promise<void>; round: () => Promise<void>; workerId: string } {
  if (!mayBuild(settings)) return { stop: async () => undefined, round: async () => undefined, workerId };
  const { target, deployment } = settings;
  /** What was stored when the adapters were last built; null until the first round has looked. */
  let builtFrom: string | null = null;
  let stopped = false;
  const attest = async (code: string, generation: number) => {
    // The unit of work's transaction (slice R.5; before it, the client's own transaction): the same statements in
    // the same order. It queues no notice, so nothing is published after it.
    await uow.runTx(async (tx) => {
      // Shared: several workers attest at once, and each waits for a write of the credential, a pause or an approval.
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Provider" WHERE "code" = ${code} FOR SHARE`;
      const provider = rows[0];
      if (!provider) return;
      // Read after the lock is held: a replacement that committed while this waited is what it finds.
      const stored = await tx.$queryRaw<{ generation: number }[]>`SELECT "generation" FROM "ProviderCredential" WHERE "providerId" = ${provider.id} AND "target" = ${target}`;
      if (stored[0]?.generation !== generation) {
        await tx.$executeRaw`DELETE FROM "ProviderWorkerAttestation" WHERE "providerId" = ${provider.id} AND "workerId" = ${workerId}`;
        return;
      }
      await tx.$executeRaw`
        INSERT INTO "ProviderWorkerAttestation" ("id", "providerId", "workerId", "deployment", "target", "generation", "attestedAt")
        VALUES (${randomUUID()}, ${provider.id}, ${workerId}, ${deployment}, ${target}, ${generation}, now())
        ON CONFLICT ("providerId", "workerId") DO UPDATE SET "deployment" = EXCLUDED."deployment", "target" = EXCLUDED."target", "generation" = EXCLUDED."generation", "attestedAt" = now()`;
    });
  };
  /** This worker's rows for providers it no longer holds an adapter for, and anybody's rows long past belief. */
  const clear = async (held: string[]) => {
    await uow.prisma.$executeRaw`
      DELETE FROM "ProviderWorkerAttestation" a USING "Provider" p
      WHERE p."id" = a."providerId" AND ((a."workerId" = ${workerId} AND NOT (p."code" = ANY(${held}::text[]))) OR a."attestedAt" < now() - make_interval(secs => ${STALE_AFTER_MS / 1000}))`;
  };
  let running: Promise<void> | null = null;
  const once = async () => {
    const stored = await storedGenerations(uow.prisma, settings);
    if (builtFrom === null) builtFrom = [...gateway.held()].map((code) => `${code}:${gateway.generation(code)}`).sort().join(',');
    if (stored !== builtFrom) {
      const built = await rebuild();
      gateway.use(built);
      builtFrom = stored;
      for (const [code, why] of built.skipped) log.warn(`provider dispatch: no adapter for ${code} (${why})`);
      log.log(`provider dispatch: adapters rebuilt from the stored credentials (${built.adapters.size} held)`);
    }
    const held = gateway.held();
    for (const code of held) {
      const generation = gateway.generation(code);
      // A worker that was told to stop writes nothing more: its rows are being removed.
      if (generation !== null && !stopped) await attest(code, generation);
    }
    await clear(held);
  };
  /** One round at a time: a slow round is not overtaken by the next tick. */
  const round = () => {
    if (stopped) return Promise.resolve();
    running ??= once().catch((error) => log.warn(`readiness failed: ${errorCode(error)}`)).finally(() => { running = null; });
    return running;
  };
  void round();
  const timer = setInterval(() => void round(), everyMs);
  timer.unref?.();
  return {
    workerId,
    round,
    stop: async () => {
      stopped = true;
      clearInterval(timer);
      // The round in flight ends first, so nothing it writes outlives the removal below.
      await running;
      await uow.prisma.providerWorkerAttestation.deleteMany({ where: { workerId } }).catch(() => undefined);
    },
  };
}
