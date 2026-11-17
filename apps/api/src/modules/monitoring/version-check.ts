import { z } from 'zod';
import { UnitOfWork, env, errorCode, isTest, logger } from '../platform';
import { SYSTEM } from './alert-pass';
import { AlertRepository } from './alert.repository';
import { within } from './probe-time';
import {
  VERSION_ANSWER_MAX_BYTES, VERSION_CALL_TIMEOUT_MS, VERSION_CHECK_EVERY_MS, VERSION_CHECK_FIRST_AFTER_MS, VERSION_CHECK_TICK_MS,
} from './thresholds';
import { VersionsRepository, type Found } from './versions.repository';
import { STACK, isNewer, newestOf, parseVersion, type Cycle, type StackComponent } from './versions.rules';

const log = logger('VersionCheck');

/** Whether this deployment may call out at all (`VERSION_CHECK=off` says no). */
export function versionCheckOn(): boolean {
  return env('VERSION_CHECK') !== 'off';
}

/** One call: the answer's JSON, or a throw. Given the URL and a signal that ends it. */
export type VersionFetcher = (url: string, signal: AbortSignal) => Promise<unknown>;

/** A failed call, by a word `errorCode` cannot see in a message: `http` for a status, `too_large`, `in_spec`. */
class VersionCallError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * The default call: global `fetch`, a GET of the URL and nothing else (no cookie, no header of ours but `accept`),
 * never following a redirect (an answer that says to go elsewhere is a failed call), an answer of at most
 * `VERSION_ANSWER_MAX_BYTES` read as JSON. Never under the specs: a spec that checks hands in its own fetcher.
 */
export const fetchJson: VersionFetcher = async (url, signal) => {
  if (isTest()) throw new VersionCallError('in_spec');
  const response = await fetch(url, { signal, redirect: 'error', headers: { accept: 'application/json' } });
  if (!response.ok) throw new VersionCallError('http');
  const text = await response.text();
  if (text.length > VERSION_ANSWER_MAX_BYTES) throw new VersionCallError('too_large');
  return JSON.parse(text) as unknown;
};

/** Where a component is asked: the npm registry's `latest` for a library, endoflife.date's cycles for a runtime. Only its name is sent. */
export function urlOf(component: StackComponent): string {
  return component.kind === 'library'
    ? `https://registry.npmjs.org/${encodeURIComponent(component.name)}/latest`
    : `https://endoflife.date/api/${encodeURIComponent(component.name)}.json`;
}

// The answers' shapes: what is read of them, nothing else. An answer of another shape is a failed call.
const NpmLatest = z.object({ version: z.string().min(1).max(64) });
const EolCycles = z
  .array(z.object({
    cycle: z.union([z.string().min(1).max(32), z.number()]),
    latest: z.union([z.string().min(1).max(64), z.number()]),
    eol: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.boolean()]),
  }))
  .min(1)
  .max(200);

/**
 * What an answer says, by its component's kind; a throw when it is not of its shape. A pre-release is never the
 * newest: a registry whose `latest` is one (it happens: a package that publishes a release candidate under
 * `latest`) answers no release (`latest` null), and the component keeps the last release it had.
 */
export function readAnswer(component: StackComponent, answer: unknown): { latest: string | null; cycles: Cycle[] | null } {
  if (component.kind === 'library') {
    const { version } = NpmLatest.parse(answer);
    return { latest: parseVersion(version)?.pre === false ? version : null, cycles: null };
  }
  const cycles = EolCycles.parse(answer).map((row) => ({ cycle: String(row.cycle), latest: String(row.latest), eol: row.eol }));
  const latest = newestOf(cycles);
  if (!latest) throw new VersionCallError('no_release');
  return { latest, cycles };
}

export type CheckResult = { checked: number; failed: number; news: string[] };

/**
 * The version check (spec 2026-11-17-system-monitor, section 5; slice M.11): every component asked at once, each
 * call under its own time limit; what came is validated (`readAnswer`) and written in one transaction with the
 * components' rows locked, a failed call keeping the last answer. A component whose newest is newer than the one
 * stored is news; one with nothing stored is not (the first check of a fresh database would announce everything).
 * News is told to the branch owners as one `system.update` notice, in the same transaction, so two checks at the
 * same time tell it once. With `VERSION_CHECK=off` nothing is called and nothing is written.
 */
export class VersionCheck {
  private inFlight: AbortController | null = null;

  constructor(
    private readonly repo: VersionsRepository,
    private readonly uow: UnitOfWork,
    private readonly audience: Pick<AlertRepository, 'branchOwners'>,
    private readonly fetcher: VersionFetcher = fetchJson,
    private readonly components: readonly StackComponent[] = STACK,
    private readonly timeoutMs: number = VERSION_CALL_TIMEOUT_MS,
  ) {}

  /** One check; null when this deployment calls nothing. */
  async run(now: Date = new Date()): Promise<CheckResult | null> {
    if (!versionCheckOn()) return null;
    const controller = new AbortController();
    this.inFlight = controller;
    try {
      const found = await Promise.all(this.components.map((component) => this.ask(component, controller.signal)));
      // Stopped while asking: nothing is written, so a stop never marks every component failed.
      if (controller.signal.aborted) return null;
      return await this.store(found, now);
    } finally {
      if (this.inFlight === controller) this.inFlight = null;
    }
  }

  /** Ends the calls in flight (a stopping worker): the check writes nothing, and what came before stays. */
  abort(): void {
    this.inFlight?.abort();
  }

  private async ask(component: StackComponent, stop: AbortSignal): Promise<Found> {
    try {
      const signal = AbortSignal.any([stop, AbortSignal.timeout(this.timeoutMs)]);
      // `within` too: a fetcher that does not listen to its signal still loses its turn.
      const answer = await within(this.timeoutMs, () => this.fetcher(urlOf(component), signal));
      return { component, failed: false, ...readAnswer(component, answer) };
    } catch (error) {
      // The component's name and a code: never the answer or the error's words.
      log.warn(`${component.name}: not checked (${error instanceof VersionCallError ? error.code : error instanceof z.ZodError ? 'malformed' : errorCode(error)})`);
      return { component, failed: true };
    }
  }

  private store(found: Found[], now: Date): Promise<CheckResult> {
    return this.uow.runTx(async (tx) => {
      const known = await this.repo.lockKnown(tx, found.map((row) => row.component.name));
      const news: string[] = [];
      for (const answered of found) {
        const previous = known.get(answered.component.name) ?? null;
        // No release in the answer: the last release stays (a pre-release stored before is not one).
        const row = answered.failed || answered.latest !== null ? answered : { ...answered, latest: parseVersion(previous)?.pre === false ? previous : null };
        const newer = !row.failed && previous !== null && isNewer(row.latest, previous);
        await this.repo.save(tx, row, now, newer ? previous : null);
        if (newer) news.push(row.component.name);
      }
      if (news.length > 0) {
        const owners = (await this.audience.branchOwners(tx)).map((owner) => owner.id);
        this.uow.queueNotices(tx, await this.uow.notice.write(tx, owners, SYSTEM, { kind: 'system.update', payload: { count: news.length, names: news } }));
      }
      return { checked: found.length, failed: found.filter((row) => row.failed).length, news };
    });
  }
}

/**
 * The daily check as the worker runs it: `firstAfterMs` after its start (not holding it up), then every `tickMs` it
 * checks when the last check of the database is a day old (`VERSION_CHECK_EVERY_MS`), so a worker that restarts
 * often still calls once a day. One check at a time; a failing one logs a code. `stop` clears the timers, ends the
 * calls in flight and waits for the check. Run by `worker.ts` on the dispatch's unit of work.
 */
export function startVersionCheck(uow: UnitOfWork, timing: { firstAfterMs?: number; tickMs?: number } = {}, given?: VersionCheck) {
  const repo = new VersionsRepository(uow);
  const check = given ?? new VersionCheck(repo, uow, new AlertRepository(uow));
  let stopped = false;
  let running: Promise<void> | null = null;
  const due = async () => {
    if (!versionCheckOn()) return;
    const last = await repo.lastCheckedAt();
    if (last && Date.now() - last.getTime() < VERSION_CHECK_EVERY_MS) return;
    const done = await check.run();
    if (done) log.log(`versions: ${done.checked} checked, ${done.failed} failed, ${done.news.length} newer`);
  };
  const tick = () => {
    if (stopped) return Promise.resolve();
    running ??= due().catch((error) => log.warn(`version check failed: ${errorCode(error)}`)).finally(() => { running = null; });
    return running;
  };
  const first = setTimeout(() => void tick(), timing.firstAfterMs ?? VERSION_CHECK_FIRST_AFTER_MS);
  first.unref?.();
  const timer = setInterval(() => void tick(), timing.tickMs ?? VERSION_CHECK_TICK_MS);
  timer.unref?.();
  return {
    tick,
    stop: async () => {
      stopped = true;
      clearTimeout(first);
      clearInterval(timer);
      check.abort();
      await running;
    },
  };
}
