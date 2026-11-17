import { Injectable } from '@nestjs/common';
import { UnitOfWork, errorCode, fail, logger } from '../platform';
import { requireOwner, type Actor } from '../access';
import { AlertRepository } from './alert.repository';
import { within } from './probe-time';
import { StatusRedis } from './status-redis';
import { PROBE_TIMEOUT_MS, VERSION_CHECK_AGAIN_AFTER_MS } from './thresholds';
import { VersionCheck, versionCheckOn, type VersionFetcher } from './version-check';
import { installedVersionOnce } from './versions-installed';
import { VersionsRepository, type StackVersionRow } from './versions.repository';
import { STACK, behindOf, cycleOf, plainVersion, supportOf, type Behind, type Cycle, type StackKind, type StackPlace } from './versions.rules';

const log = logger('Versions');

/** One component in one place, as the page shows it (`GET /v1/system/versions`). */
export type VersionItem = {
  name: string;
  kind: StackKind;
  where: StackPlace;
  current: string | null;
  latest: string | null;
  latestInCycle: string | null;
  behind: Behind;
  supportEnds: string | null;
  supportEnded: boolean;
  checkedAt: string | null;
  failed: boolean;
  cycles: Cycle[];
};

/**
 * The versions page (spec 2026-11-17-system-monitor, section 5; slice M.11), the branch owner's alone (D1). What is
 * in use is read now, cheaply: this process's Node.js, PostgreSQL's `server_version`, Redis's `redis_version`, the
 * worker's Node.js from its last beat, each library's installed `package.json`; each read under the probe's limit,
 * a failed one `null`. What is newest is what the last check stored. The web's own components are the web's to
 * read: their `current` is null and a web runtime carries its cycles, so the web finds its own.
 */
@Injectable()
export class VersionsService {
  private checking: Promise<unknown> | null = null;
  /** The calls of the owner's «فحص الآن»; a spec hands in its own. */
  fetcher: VersionFetcher | undefined;

  constructor(
    private readonly repo: VersionsRepository,
    private readonly redis: StatusRedis,
    private readonly alerts: AlertRepository,
    private readonly uow: UnitOfWork,
  ) {}

  async versions(actor: Actor) {
    requireOwner(actor);
    const [rows, inUse] = await Promise.all([this.repo.rows(), this.inUse()]);
    return this.view(rows, inUse, new Date());
  }

  /**
   * The owner's «فحص الآن»: a check now, then the page. Refused (`429 RATE_LIMITED`) when a check ran within the
   * last minute or one is running in this process. With `VERSION_CHECK=off` it calls nothing and answers the page.
   */
  async check(actor: Actor) {
    requireOwner(actor);
    if (versionCheckOn()) {
      const last = await this.repo.lastCheckedAt();
      if (this.checking || (last && Date.now() - last.getTime() < VERSION_CHECK_AGAIN_AFTER_MS)) return fail(429, 'RATE_LIMITED');
      const running = new VersionCheck(this.repo, this.uow, this.alerts, this.fetcher).run();
      this.checking = running;
      try {
        await running;
      } finally {
        this.checking = null;
      }
    }
    return this.versions(actor);
  }

  private async inUse(): Promise<{ postgres: string | null; redis: string | null; worker: string | null }> {
    const read = async (name: string, run: () => Promise<string | null>) => {
      try {
        return plainVersion(await within(PROBE_TIMEOUT_MS, run));
      } catch (error) {
        log.warn(`${name} version not read: ${errorCode(error)}`);
        return null;
      }
    };
    const [postgres, redis, worker] = await Promise.all([
      read('postgresql', () => this.repo.postgresVersion()),
      read('redis', async () => (this.redis.configured() ? this.redis.serverVersion() : null)),
      read('worker nodejs', () => this.repo.workerNodeVersion()),
    ]);
    return { postgres, redis, worker };
  }

  private view(rows: StackVersionRow[], inUse: { postgres: string | null; redis: string | null; worker: string | null }, now: Date) {
    const today = now.toISOString().slice(0, 10);
    const stored = new Map(rows.map((row) => [row.name, row]));
    const currentOf = (name: string, where: StackPlace): string | null => {
      if (where === 'web') return null;
      if (name === 'nodejs') return where === 'api' ? process.version : inUse.worker;
      if (name === 'postgresql') return inUse.postgres;
      if (name === 'redis') return inUse.redis;
      return installedVersionOnce(name);
    };
    const items: VersionItem[] = STACK.flatMap((component) =>
      component.where.map((where) => {
        const row = stored.get(component.name);
        const current = currentOf(component.name, where);
        const cycles = row?.cycles ?? [];
        const cycle = component.kind === 'runtime' ? cycleOf(current, cycles) : null;
        return {
          name: component.name,
          kind: component.kind,
          where,
          current,
          latest: row?.latest ?? null,
          latestInCycle: cycle?.latest ?? null,
          behind: behindOf(current, row?.latest),
          ...supportOf(cycle, today),
          checkedAt: row?.checkedAt.toISOString() ?? null,
          failed: row?.failed ?? false,
          // The web finds its own runtime's cycle in these; the API's are worked out here.
          cycles: component.kind === 'runtime' && where === 'web' ? cycles : [],
        };
      }),
    );
    const checkedAt = rows.reduce<Date | null>((found, row) => (found === null || row.checkedAt > found ? row.checkedAt : found), null);
    return { checking: versionCheckOn() ? ('on' as const) : ('off' as const), checkedAt: checkedAt?.toISOString() ?? null, items };
  }
}
