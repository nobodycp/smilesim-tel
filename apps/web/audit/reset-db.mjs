// Drops and recreates the audit database, then applies every migration. Refuses any other name.
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const url = new URL(process.env.AUDIT_DATABASE_URL ?? 'postgresql://smilesim:smilesim@127.0.0.1:5432/smilesim_audit');
const name = url.pathname.slice(1);
if (name !== 'smilesim_audit') throw new Error(`refusing to reset ${name}`);

const admin = new URL(url);
admin.pathname = '/postgres';
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
await client.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`, [name]);
await client.query(`DROP DATABASE IF EXISTS ${name}`);
await client.query(`CREATE DATABASE ${name}`);
await client.end();

const api = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'api');
execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
  cwd: api,
  env: { ...process.env, DATABASE_URL: url.toString() },
  stdio: 'inherit',
});
