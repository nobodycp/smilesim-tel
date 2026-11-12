# Coolify upgrade preparation — from the deployed commits to `3a2a3c1`

Prepared 2026-11-12. **A plan for review: nothing here has been carried out.** No deploy, no setting, no key, no
migration, no backup and no account was changed while preparing it. What is stated about the server was read on
2026-11-12 with read-only commands (container state, `SELECT`s, booleans and lengths of settings, never a value).

## 1. Where the deployment stands

| Service | Deployed commit | Behind `3a2a3c1` |
|---|---|---|
| smilesim-api | `e7679d9` (2026-11-10) | 122 commits |
| smilesim-web, smilesim-worker | `7d5e71e` (2026-11-10) | 123 commits |

- Coolify 4.7.5, three Dockerfile applications, Traefik 3.6 in front of the web only. The API has no public
  route and no published port; it is reached through the web's `/api` rewrite on the shared `coolify` network.
- PostgreSQL 16.15, one volume on the same host, 66 MB on disk (database 10 MB). Redis 7 beside it.
- Data: 4 accounts (the trial logins), 13 lines, 8 eSIM codes stored clear, 143 sessions (17 live), 25
  packages, 23 tasks (none open), 55 notices, 227 activity events.
- 49 migrations applied, none failed. **9 pending.**
- Host: 11 GB free of 48 GB (79 % used), 2.9 GB of memory available.

## 2. What still blocks the upgrade

| # | Blocker | Why |
|---|---|---|
| B1 | No backup of any kind | No Coolify schedule for this database, no S3 storage defined, no dump file, no cron. |
| B2 | `SECRETS_KEY` is not set on the API | The new API refuses to start without a 32-byte key (ADR 0016). |
| B3 | `TRUST_PROXY` is not set on the API | Same refusal. |
| B4 | A failed start would not be noticed | Health checks are off on all three applications. |
| B5 | Rolling back after the migrations is not "redeploy the old image" | See 5.3: the old API cannot create a session on the new schema. |
| B6 | The old web and the new API (and the reverse) do not speak the same contract | See 6.1: the services must change together, inside a maintenance window. |

Not blocking, to decide: the four trial accounts on a public domain (4.4), the shared `coolify` network (4.5),
the database's single superuser role (4.5), and the "auto deploy" switch that is on although no webhook exists.

## 3. Backup and restore (phase 1)

**Superseded in detail by `backup-and-restore.md`** (the scripts, the storage rules, the restore proof and the
rehearsal, tried on synthetic data). What follows is the first outline.

### 3.1 Design

- **What:** `pg_dump --format=custom` of the SmileSim database, taken inside the postgres container (it has
  `pg_dump` 16), streamed out; never written unencrypted to disk.
- **Encrypted before it touches the disk:** `gpg --encrypt` to a **public** key. The private key never exists on
  the server, so the server cannot open its own backups and a copy of the server does not hand over the data.
  `gpg` is already on the host.
- **Off the server:** each encrypted file is copied to storage outside this host. Two workable ways, the owner
  picks one: (a) an S3-compatible bucket in another provider, written with a credential that can only add
  objects; (b) the owner's machine or another server pulls the files over SSH on a schedule. A copy that exists
  only on this host does not count as a backup.
- **When:** nightly, plus one on demand immediately before any upgrade step that changes data.
- **Retention:** on the host 7 daily files; off the host 14 daily, 8 weekly, 12 monthly. At today's size a file
  is a few MB, so the whole set stays far under 1 GB; the script refuses to run under 2 GB free and reports it.
- **Checked every run:** the file is not empty, `gpg --list-packets` reads it, and its size is logged. A run that
  fails says so (exit code and one line); a silent failure is the usual way backups are lost.
- **Not covered, on purpose:** Redis (live session keys, rate counters, the queue). Losing it signs people out
  and nothing else; sessions and all business data are in PostgreSQL.
- **The key for sealing (`SECRETS_KEY`) is not in the database dump** and must be kept separately (4.1). A
  restored database is unreadable for sealed values without it.

Coolify's own scheduled backup was considered: it can upload to S3 but does not encrypt before upload, so it
needs a bucket with server-side encryption and trusts the bucket's keys. The `gpg` route keeps the decision
with the owner's key. Either is acceptable; the first needs only Coolify settings, the second a small script.

### 3.2 Restore path (documented, to be rehearsed)

1. Fetch the chosen encrypted file from the off-server copy.
2. On a machine that holds the private key: `gpg --decrypt file.dump.gpg > file.dump`.
3. `pg_restore --no-owner --clean --if-exists --dbname <target> file.dump` into an **empty** PostgreSQL 16.
4. Check: row counts of `User`, `Line`, `OfficeTask`, `WalletEntry`, `Session`; `prisma migrate status` lists the
   same migrations as applied.
5. To put it in service: stop the API and the worker, restore into the production database, start the image of
   the commit that matches the dump's migrations, then the web.

### 3.3 Testing the restore without touching production

On the owner's machine (or any host that is not this server): a throwaway `postgres:16` container with its own
volume, restore the latest encrypted dump into it (steps 1–4), then use the same copy for the upgrade rehearsal
in 5.4. Production is only read (the dump); nothing is restored onto it.

### 3.4 Needs approval before anything is run

Taking the first dump (it reads all data and creates a file), where the off-server copy lives, who holds the
private key, and installing the schedule.

## 4. Security settings (phase 2)

### 4.1 `SECRETS_KEY`

- Generate on the owner's machine, not on the server and not in a chat or a ticket:
  `openssl rand -base64 32`. Paste it once into the API application's environment in Coolify (runtime only, not
  build time). The worker and the web do not need it.
- Keep a second copy outside the server (a password manager entry named for this deployment). Losing the key
  loses every sealed eSIM code and authenticator secret.
- Check without showing it, inside the API container: the length printed must be `32`.
  `node -e "console.log(Buffer.from(process.env.SECRETS_KEY||'','base64').length)"`
- Today nothing is sealed (0 sealed codes, 0 accounts with an authenticator, 1 pending secret stored clear), so
  a new key cannot break existing data.
- Never in Git, never in a build argument, never in a log.

### 4.2 `TRUST_PROXY`

What was read: Traefik's start command carries no `forwardedHeaders` option (its other configuration was not
read), and by its default it then discards forwarded headers a client sends and writes its own
`X-Forwarded-For` with the caller's address; the web's rewrite (Next) passes that
header on and adds no entry of its own (`proxy-request.js` sets only `x-forwarded-host`); DNS points straight
at the host (Cloudflare serves names only). The API therefore sees one proxy between it and the header's last
entry: **the value by analysis is `1`**. (An earlier note said "probably 2"; that was a guess and is withdrawn.)

It is confirmed, not assumed, right after the upgrade with two requests from a known address: (1) a sign-in
whose audit entry must show that address; (2) the same sign-in sent with a forged `X-Forwarded-For` header,
whose audit entry must still show the real address. If either fails, the value is corrected before the service
is opened again.

### 4.3 Cookies

Already right on the server: `COOKIE_SECURE` is `true`, the five web origins are https origins, a cookie domain
is set. No change needed.

### 4.4 The trial accounts

The four accounts are the trial logins (`branch`, `main`, `agent`, `pos`), created by the trial seed with a
published password, on a public domain. `TRIAL_SEED` is off, so they are not re-created; whether their
passwords were changed since was **not** tested. Before real data: the owner sets new passwords for the ones to
keep and disables the rest. Until then the site should be treated as a trial site. No account was touched.

### 4.5 Separation

- The API and the worker connect as the database's only login role, which is a superuser. A role that owns the
  schema but is not a superuser is enough for both (the append-only trigger and the migrations need ownership,
  not superuser). Worth doing before real data; it is a change to the database and the connection settings, so
  it is listed for approval, not planned into this upgrade.
- The API sits on the `coolify` network with 31 other containers of other projects. Any of them can reach it
  directly and name any caller address in a header. A network of its own for the three services and the data
  containers closes that. Also listed for approval.
- The worker needs only `DATABASE_URL`, `REDIS_URL`, `APP_ROLE=worker` (present). It does not need the key.

## 5. Health checks, migrations and rollback (phases 3 and 4)

### 5.1 Health checks

- The API answers `GET /health` (200 in 1 ms, checked from inside the container). The web answers `/login`
  (200). The worker has no port: its health is "the process is running".
- **Trap:** the images are `node:24-bookworm-slim` and contain neither `curl` nor `wget` (checked in the running
  containers). The check Coolify builds from a path and a port calls one of them (Coolify's documented
  requirement; not tried here), so switching it on as it is would mark a healthy container unhealthy. The check must use `node`:
  - API: `node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`
  - Web: the same against `http://127.0.0.1:3000/login`.
  - Worker: none over HTTP; the restart policy (`unless-stopped`, already set) restarts it when it exits.
  Either as a command check in Coolify, or as a `HEALTHCHECK` line in the two Dockerfiles (the API's must do
  nothing when `APP_ROLE=worker`). The Dockerfile route is versioned and is a code change, for approval.
- **Timing:** the API today is ready 9 s after its container starts (5 s to check migrations, 4 s to start).
  With nine migrations to apply on this data it stays in seconds. Proposed: start period 60 s, interval 10 s,
  timeout 5 s, 6 retries.
- **What a failed check gives:** with the check on, Coolify keeps the previous container when the new one does
  not become healthy. That protects against a refused configuration (B2, B3). It does **not** undo migrations
  the new container already applied before failing (5.3).

### 5.2 The nine migrations, one by one

All tables involved are tiny here (the largest is 240 kB), so every lock below is held for milliseconds.

| # | Migration | Touches | Locks | Deletes / renames | Safe on today's data | Old API still works after it |
|---|---|---|---|---|---|---|
| 1 | `130000_session_token_hash` | `Session`: new `tokenHash`, filled with the hash of each id, NOT NULL, unique index | `ACCESS EXCLUSIVE` on `Session` for the column change | none | Yes: 143 rows, 143 distinct ids, so the unique index cannot collide. The rows are kept, but **the sessions do not stay signed in**: the deployed version names the live-session key in Redis `session:<row id>`, the new one looks for `session:<hash>` (found by the rehearsal, `backup-and-restore.md` section 9). Everyone signs in again. Four statements, not one transaction: a failure between them would leave the column added but not required | **No.** The old API creates sessions without `tokenHash`: every new sign-in fails |
| 2 | `140000_notice_login_name_keys` | `Notice.payload`: `toLogin` / `fromLogin` keys renamed | row locks | renames two JSON keys | Yes: 0 of 55 notices carry the old keys, it changes nothing | Yes |
| 3 | `150000_package_public_codes` | `Package.code` rewritten; `Package.providerProductCode` filled; `Line.terms`, `ActivityEvent.subjectRef` follow | row locks, one DO block (all or nothing) | **renames every package's public code** | Yes, checked on the data: 25 packages give 25 distinct new codes, none equals another package's old code, none is null; the 23 packages with no product code get one without colliding on (provider, product code) | Yes, but links and bookmarks that hold an old package code stop resolving |
| 4 | `160000_provider_operations` | two new tables | none on existing tables beyond the FK's brief lock on `Provider`, `Line` | none | Yes: neither table exists | Yes |
| 5 | `170000_outbox_sequence` | new table's column and index | — | none | Yes | Yes |
| 6 | `180000_dispatch_leases` | new tables' columns | — | none | Yes | Yes |
| 7 | `190000_activation_settlement_schema` | new nullable columns on `ProviderOperation`, `OfficeTask`, `Provider`; two new tables; a trigger | `ACCESS EXCLUSIVE` on `OfficeTask` and `Provider`, momentarily | none | Yes: additive, the CHECKs concern only the new columns | Yes |
| 8 | `200000_open_activation_reservations` | two partial unique indexes on `OfficeTask` | `SHARE ROW EXCLUSIVE` on `OfficeTask`, 30 s lock timeout, one DO block | none | Yes: 0 groups share a serial, 0 share a number, and there is no open task at all | Yes (a duplicate open activation would be refused as a conflict) |
| 9 | `20261111100000_two_factor_policy` | `LayerPolicy.method`, `User.twoFactorRequired`, `User.requiredMethod` | `ACCESS EXCLUSIVE` on `User`, `LayerPolicy`, momentarily | none | Yes: defaults fill every row | Yes |

### 5.3 What this means for rollback

- Migrations 2–9 leave the old API working. **Migration 1 does not:** once it has run, the old image serves
  existing sessions but cannot sign anyone in.
- So after the migrations, "keep the old container" or "redeploy the old image" is not a working rollback by
  itself. The real ones are: (a) restore the pre-upgrade dump, then start the old images — clean, and inside a
  maintenance window nothing is lost; (b) emergency only, for approval at the time: drop the NOT NULL on
  `Session.tokenHash` so the old API can create sessions again.
- The package codes are renamed for good; only (a) brings the old ones back.

### 5.4 Tests before applying (off production)

On the restored copy from 3.3: run `prisma migrate deploy` from `3a2a3c1` and confirm nine applied, none
failed; start the new API against the copy with a test key and run the smoke list of 6.4; run
`seal-secrets --dry-run` against the copy and compare its counts with section 1 (8 clear line codes).

## 6. Upgrade plan (phase 5)

### 6.1 Compatibility between versions

Between the deployed commits and `3a2a3c1` the wire contract changed: every list answers
`{ items, nextCursor, total }` with one cursor, an account is named `…LoginName` in requests and answers, a
missing target answers 404, the session cookie is a token. The deployed web cannot read the new API's lists and
the new web cannot read the old API's. **There is no order of the three services that keeps the site working
while they differ.** The worker shares no contract with the web; it must match the API's schema.

Consequence: one maintenance window in which all three change, not a rolling upgrade.

### 6.2 Order

| Step | Action | Stop and roll back if |
|---|---|---|
| P1 | Approvals of section 7 given; off-server storage and the backup key exist | — |
| P2 | Nightly backup installed; one restore rehearsed off production (3.3); upgrade rehearsed on the copy (5.4) | the rehearsal fails: fix first |
| P3 | Health checks defined with `node` (5.1); `SECRETS_KEY` and `TRUST_PROXY=1` saved in Coolify **without redeploying** (the running, older API ignores both) | — |
| W1 | Window opens: the web is put in Coolify's maintenance mode | — |
| W2 | Fresh dump, encrypted, copied off the server, its size and readability checked | the dump cannot be verified |
| W3 | Read-only checks again: 49 applied / 0 failed, 0 reservation conflicts, package-code map without collisions | any differs from section 5.2 |
| W4 | Deploy the API. Its start applies the nine migrations, then it must pass `/health` | the API is not healthy: restore W2's dump, start `e7679d9` again |
| W5 | Deploy the worker | it restarts in a loop: read its log; roll back as W4 |
| W6 | Deploy the web; maintenance mode off for the testers only if possible, else off | — |
| W7 | Smoke tests (6.4), then the `TRUST_PROXY` check of 4.2 | a blocking smoke test fails: roll back as W4 |
| W8 | Window closes | — |
| ⛔ | **Stop. The backfill is not part of this window.** `seal-secrets --dry-run` only, to read the counts (expected: 8 line codes clear, 0 sealed) | — |
| B1 | On the owner's word, another day: a fresh dump, then `seal-secrets`, then `--dry-run` until both tables show 0 clear | counts do not go down: stop, do not repeat blindly |

The migrations run when the API starts (the image's command); there is no separate step to apply them, which is
why W2 and W3 come immediately before W4.

### 6.3 Rollback at each stage

- Before W4: nothing changed; close the window.
- W4 fails before any migration ran (a refused setting): the old API is still serving; fix the setting.
- W4 fails after some or all migrations ran: restore W2's dump, redeploy `e7679d9` (API) and `7d5e71e` (worker,
  web). Because the web was in maintenance, no write is lost.
- After W8 with real use: rolling back loses what was written since W2; prefer fixing forward.
- After the backfill: no decryption in bulk exists; the way back is the dump taken before it.

### 6.4 Smoke tests

Sign-in (password, then authenticator on an account that has one); a cookie from before the upgrade is refused and the account signs in again;
numbers list with filters and pages; an eSIM's code opened from the list, from the line page and from a task
page; a line outside the caller's tree answers 404; an eSIM activation on a trial number (code shown, charged
once); a SIM change opened as a task and completed (code on the line, second completion refused); packages open
under their new codes; notices list; sign-out. The API log shows no `ESIM_CODE_UNSEALABLE` and no refused
setting.

## 7. Needs the owner's approval before it is done

1. Taking dumps of the database, and where the off-server copy lives.
2. Who generates and holds the backup private key and `SECRETS_KEY`.
3. Saving `SECRETS_KEY` and `TRUST_PROXY=1` in Coolify.
4. Health checks: a command check in Coolify, or a `HEALTHCHECK` in the Dockerfiles (a code change).
5. The maintenance window and its date.
6. The trial accounts: new passwords, or disabling.
7. Later, separately: a non-superuser database role, a network of its own, switching "auto deploy" off.
8. The backfill, on its own day.
