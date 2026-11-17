import { POOL_MAX_CEILING, env, poolMaxSetting } from './config';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';
import { PrismaClient } from './generated/prisma/client';

// The database settings of every client the application opens (plan 2026-11-17-database-scale, DB.15; the owner's
// values of 2026-11-17). Each limit is sent by the client when it connects (a startup parameter of the
// connection), so it binds this application's connections only: `prisma migrate deploy`, `pg_dump` and the backup
// scripts, and an operator's `psql`, open their own connections and are never cut by them. Nothing is set on the
// database role or the server, which are not the application's to change.

/** The API's limit on one statement: a statement still running after it is cancelled (PostgreSQL `57014`). */
export const API_STATEMENT_TIMEOUT_MS = 15_000;
/**
 * The CSV exports' limit on one statement (`withExportLimit`): an export reads up to 10,000 rows over a long
 * period. Kept under the 100 s Cloudflare waits for an answer, so the caller is told by the API, not the proxy.
 */
export const EXPORT_STATEMENT_TIMEOUT_MS = 90_000;
/**
 * The worker's limit on one statement. Longer than the API's: the sweeper, the waiting pass and the daily purges
 * read and delete in pages (at most 5,000 rows a purge statement), and none of them has a person waiting on it.
 */
export const WORKER_STATEMENT_TIMEOUT_MS = 60_000;
/**
 * How long any connection of the application may sit inside an open transaction doing nothing before PostgreSQL
 * ends its session (`25P03`). No transaction of the application waits on anything but the database (a provider is
 * called after the mark is committed), so only a stuck process reaches it, and its row locks are let go.
 */
export const IDLE_IN_TRANSACTION_TIMEOUT_MS = 30_000;

/** Who the client is for. */
export type DatabaseRole = 'api' | 'export' | 'worker' | 'purge' | 'tool';

type RoleSettings = {
  /** The pool's size when `DATABASE_POOL_MAX` does not set it (or always, when `fromEnv` is false). */
  pool: number;
  /** Whether `DATABASE_POOL_MAX` sets this pool's size: the process's main pool only. */
  fromEnv: boolean;
  /** `null`: no limit of the application's (an operator's command-line tool). */
  statementTimeoutMs: number | null;
};

export const DATABASE_ROLES: Record<DatabaseRole, RoleSettings> = {
  // The API's one client (`PrismaService`), shared by every store and service.
  api: { pool: 20, fromEnv: true, statementTimeoutMs: API_STATEMENT_TIMEOUT_MS },
  // The API's second, small client, used by the CSV exports only (`withExportLimit`); exports are rare and the owner's.
  export: { pool: 2, fromEnv: false, statementTimeoutMs: EXPORT_STATEMENT_TIMEOUT_MS },
  // The worker's client: dispatch, settlement, sweeper, heartbeat, alerts.
  worker: { pool: 10, fromEnv: true, statementTimeoutMs: WORKER_STATEMENT_TIMEOUT_MS },
  // The worker's daily purge, opened and closed once a day; its purges run one after another.
  purge: { pool: 2, fromEnv: false, statementTimeoutMs: WORKER_STATEMENT_TIMEOUT_MS },
  // The command-line tools an operator runs by hand (`cli/`): no statement limit, a whole-table pass may be long.
  tool: { pool: 2, fromEnv: false, statementTimeoutMs: null },
};

/**
 * The pool settings of a client for `role`: its size, its two time limits, and its name in `pg_stat_activity`
 * (`smilesim-<role>`). Throws when `DATABASE_POOL_MAX` is set to anything but a whole number from 1 to
 * `POOL_MAX_CEILING` (a production process has already refused to start on it: `production-config.ts`).
 */
export function poolConfigOf(role: DatabaseRole, connectionString: string, poolMax: string | undefined = env('DATABASE_POOL_MAX')): PoolConfig {
  const settings = DATABASE_ROLES[role];
  const asked = settings.fromEnv ? poolMaxSetting(poolMax) : undefined;
  if (asked === null) throw new Error(`DATABASE_POOL_MAX: must be a whole number from 1 to ${POOL_MAX_CEILING}.`);
  return {
    connectionString,
    max: asked ?? settings.pool,
    application_name: `smilesim-${role}`,
    ...(settings.statementTimeoutMs === null ? {} : { statement_timeout: settings.statementTimeoutMs }),
    idle_in_transaction_session_timeout: IDLE_IN_TRANSACTION_TIMEOUT_MS,
  };
}

export function createPrismaClient(role: DatabaseRole = 'api'): PrismaClient {
  const connectionString = env('DATABASE_URL');
  if (!connectionString) throw new Error('DATABASE_URL is required');
  return new PrismaClient({ adapter: new PrismaPg(poolConfigOf(role, connectionString)) });
}
