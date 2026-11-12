# SmileSim database: backup, restore, and the upgrade rehearsal

Prepared 2026-11-12 for phase 1 of `2026-11-12-coolify-upgrade-preparation.md`. **The scripts exist and were run
on synthetic data only. No backup of the production database has been taken, no setting was changed, no key for
production was made.** Section 7 is the plan for the real data and needs the owner's word before any of it.

## 1. What is in the repository

| File | What it does | Where it runs |
|---|---|---|
| `scripts/backup/backup.sh` | One encrypted backup, with the fingerprint of what it holds | the database host |
| `scripts/backup/fingerprint.sql` | What a database holds, without any of it: per table a row count and a content checksum; every migration, constraint, index, trigger, column, sequence | inside both scripts |
| `scripts/backup/verify-restore.sh` | Restores a backup into a throwaway PostgreSQL 16 and compares it with its fingerprint | **not** the production host; a machine that holds the private key |
| `scripts/backup/rehearse-upgrade.sh`, `rehearsal-smoke.mjs` | The pending migrations and the new API on the restored copy | the same machine |
| `scripts/backup/backup.env.example` | The settings of `backup.sh` | the database host |
| `scripts/backup/testing/` | Synthetic rows on the deployed schema, and the cases that must fail | a developer's machine |

They need `docker` and `bash` only (plus `node` for the rehearsal). `pg_dump`, `pg_restore`, `psql` and `gpg` are
used from the `postgres:16` image itself, so the host installs nothing.

## 2. How a backup is taken

- **Consistent.** One session opens a read-only snapshot (`repeatable read`), exports it, reads the fingerprint
  in it, and `pg_dump --snapshot=` dumps that same snapshot. Writes that happen meanwhile are simply not in it;
  a restore is compared with exactly what was dumped. Tested with 400 wallet moves written during a backup: the
  backup says rows were written, and still restores to its own snapshot.
- **Never unencrypted at rest.** `pg_dump --format=custom` is piped into `gpg --encrypt` **inside the postgres
  container**; what leaves the container is ciphertext. No clear dump exists on any disk, on the host or off it.
- **To a public key.** The host holds the public key only (the script refuses a file that holds a private one).
  A copy of the host, or of the off-site storage, opens nothing. AES-256, with OpenPGP's integrity check: a
  changed or cut file fails to decrypt.
- **Checked before it counts.** Not empty; an OpenPGP message encrypted to a public key; its SHA-256 and size in
  the manifest; the fingerprint lists tables. Then uploaded; only after the upload succeeds are older local
  copies pruned (the newest `BACKUP_KEEP_LOCAL`, 7, stay).
- **The manifest** (`<id>.manifest`) travels with the file: id, time, kind, bytes, SHA-256, and the fingerprint.
  It holds names, counts and checksums, no row.
- **`--final`** is the backup before an upgrade or a rollback. It refuses unless no other session is connected
  to the database and no row was written while it ran, and unless it was uploaded off the host.
- **Exit code** 0 only for a verified, written backup (uploaded, when an upload command is set). Otherwise the
  last line on stderr says why, and nothing is printed of the data or of any setting.

Not in the backup, by decision: Redis (live-session keys, rate counters); database roles and privileges (the
restore target has its own); `SECRETS_KEY`, which is not in the database at all and is kept separately. A
restored database's sealed values are unreadable without that key.

## 3. Off-site storage

The upload is a command the owner supplies (`BACKUP_UPLOAD_CMD <file> <manifest>`), so the storage can change
without touching the script. What it must give, whichever product is used:

- **Another provider and another account** than the server's.
- **A credential on the server that can only add objects**: put, under one prefix. No list, no read, no delete,
  no change of settings. Stolen with the server, it cannot read old backups or remove them.
- **Protection from deletion, accidental or not:** object versioning with a retention lock (S3 "Object Lock" in
  compliance mode, or the provider's equivalent) for at least 30 days. An overwrite makes a new version; a
  delete is refused until the lock ends, even with the account's own keys.
- **Retention by the storage, not by the server:** lifecycle rules there keep 14 daily, 8 weekly, 12 monthly. The
  server cannot delete, so it cannot be made to.
- **A second, read-only credential** kept with the private key, off the server, for restores.
- Server-side encryption is welcome and not relied on: the files are already encrypted to the owner's key.

If no object storage is wanted, the same is reached by pulling: a machine outside the server fetches
`BACKUP_DIR` over SSH with a key that may only read that directory, and keeps its own history. Then the server
holds no storage credential at all. One of the two; a copy that stays on the server is not a backup.

## 3a. Cloudflare R2 (chosen 2026-11-12; **not set up yet**)

No bucket, token or schedule exists. The scripts were run against a local stand-in for an S3 bucket
(`testing/fake-s3.mjs`), which checks the SigV4 signature and the body's SHA-256 and MD5 and refuses to replace an
object; **nothing was sent to Cloudflare**, so R2's own behaviour is taken from its documentation (read
2026-11-12) and is first proved by step R2 of section 7.

| Need | How R2 gives it |
|---|---|
| Private | A bucket is private unless a public development URL or a custom domain is switched on. Neither is. |
| No delete, no overwrite | **Bucket lock** rules by prefix and age: `smilesim/daily/` 90 days, `smilesim/monthly/` 365 days. R2 has no object versioning and does not implement the S3 Object Lock API; bucket locks are its mechanism, and they also stop lifecycle deletion until they end. |
| Retention | Lifecycle rules delete after the lock: `daily/` at 91 days, `monthly/` at 366. |
| A name written once | `PutObject` with `If-None-Match: *` (documented as atomic), on top of the lock. |
| Least privilege | Two **account** API tokens scoped to this one bucket: "Object Read & Write" on the server, "Object Read only" for restores. R2 has no write-only permission, so the server's token can read; what it reads is ciphertext. Neither token can change the bucket's rules. Whoever holds the Cloudflare account can, which is why that account needs two-step verification. |
| Whole uploads | The request carries the body's SHA-256 (signed) and `Content-MD5`; afterwards the stored size is read back. |

`scripts/backup/r2-upload.sh` is `backup.sh`'s upload command; `r2-fetch.sh list | latest <dir> | <id> <dir>`
fetches on the restoring machine and checks the SHA-256 against the manifest. Both use `curl --aws-sigv4`
(curl 7.75 or later; the host has 8.18) and give the keys to curl on standard input, never on a command line.

**Cost.** Free tier per month: 10 GB of storage, 1 million Class A operations, 10 million Class B, no egress
charge. One backup is 2 uploads (4 in the first of a month) and a few reads. At today's size (a 10 MB database,
a dump of a few MB) 90 daily and 12 monthly copies stay well under 1 GB, and a month uses under 200 operations:
**no charge**. The free storage is passed when a dump reaches roughly 100 MB (102 copies × 100 MB); beyond it
storage costs $0.015 per GB-month.

## 3b. The nightly job

- `run-scheduled.sh <settings>`: one backup; one line in `backup.log` (`OK <id> <bytes>` or `FAILED <reason>`,
  never a value); `last-success` updated; an alert through `BACKUP_ALERT_CMD` when it fails; an optional
  heartbeat fetch on success for a monitor outside the host. One run at a time (a lock; a lock left by a dead
  run is taken over). The settings file must be readable by its owner only.
- `check-freshness.sh <settings>`: its own timer; alerts when no backup succeeded within `BACKUP_MAX_AGE_HOURS`
  (26), whatever the reason, including a job that was never installed.
- `systemd/`: `smilesim-backup.timer` (02:30, changed with `systemctl edit`) and `smilesim-backup-check.timer`
  (every 6 hours). **Copying the units enables nothing; `systemctl enable --now` is the step that needs the
  owner's word.**
- `verify-latest.sh <settings>`: the restore drill, on a machine that is not the host: fetch the newest, restore,
  compare, record `VERIFIED` or alert. Weekly.

## 4. Keys

- The backup key pair is made **on the owner's machine**, with a passphrase. Only the public key goes to the
  server. The private key and its passphrase are kept in two places off the server (a password manager and an
  offline copy). Without them no backup can be opened by anyone, the owner included.
- `SECRETS_KEY` (sealing) is separate, also made off the server, also kept in two places.
- A restore drill (section 5) is the only proof that the private key that is kept is the right one.

## 5. Proving a backup restores

`verify-restore.sh <file> <manifest>` on a machine that is not the production host:

1. The file's SHA-256 must be the manifest's.
2. A throwaway `postgres:16` container is started with **no network**.
3. The private key goes to a memory-only directory inside it; the file is decrypted there and piped straight into
   `pg_restore --exit-on-error`. The clear dump never touches the disk of the verifying machine either.
4. The restored database's fingerprint is taken and compared line by line with the manifest's. Row counts and
   content checksums of every table (accounts, wallets, the ledger, lines, tasks, sessions…), every migration,
   every constraint with whether it is validated, every index, trigger, column and sequence. Foreign keys are
   re-created by the restore, so a broken relation fails the restore itself.
5. It must accept a write.
6. It prints `VERIFIED <id> <sha256>`. **That line is the gate** for every step that changes data.

A difference is reported by kind and name (`table|WalletEntry`), never by content.

## 6. Rehearsing the upgrade on the restored copy

`verify-restore.sh … --keep` leaves the copy running on `127.0.0.1` and writes its address to a file only its
owner reads. `rehearse-upgrade.sh <manifest>` then, with the checkout of the commit to deploy:

1. refuses any address that is not such a throwaway copy, and a copy that was already used;
2. runs `prisma migrate deploy`: every migration applied, none unfinished;
3. checks the data: every table that existed keeps its row count; every session has its token hash; no notice
   keeps an old key; every line's package code is its package's new code; no duplicate package code; the two
   reservation indexes exist;
4. starts the new API on the copy in production mode with a key and a Redis made for the run, and sends smoke
   requests over HTTP: health, refusal without a session, sign-in and a wrong password, the numbers list and its
   SIM / eSIM filter, an eSIM code read from a line's detail, a line outside the account's tree (404), packages,
   tasks, notices;
5. runs `seal-secrets --dry-run` and compares its counts with the copy;
6. prints `REHEARSED <id>`.

**Nothing real is contacted, and what that rests on:** the copy's address is `127.0.0.1`; the API in production
mode never simulates a provider and has no provider connection in this code (every operation becomes a branch
task); sign-in codes go to `LogSender`, which sends nothing; the dispatcher is off in production; no provider or
mail setting is given to the process (it is started with an empty environment plus the rehearsal's own values).
The process is **not** network-sandboxed by the script. Where that guarantee is wanted, run the rehearsal on a
machine with no route out.

## 7. Plan for the real data (nothing below has been done)

Each step needs the one before it. A step that fails stops the plan; section 8 says what to do.

| # | Step | Where | Passes when |
|---|---|---|---|
| R1 | Owner makes the backup key pair and chooses the off-site storage (section 3, 4) | owner's machine | public key file and upload command exist |
| R2 | Install `scripts/backup`, the public key, the settings file (root only) on the host | host | `backup.sh` run by hand exits 0 and the file is off the host |
| R3 | Fetch that file from the off-site copy and run `verify-restore.sh` | owner's machine | `VERIFIED <id>` |
| R4 | `verify-restore.sh --keep`, then `rehearse-upgrade.sh` with the commit to deploy | owner's machine | `REHEARSED <id>` |
| R5 | Nightly schedule (cron, root): `backup.sh`, its exit code and last line kept in a log; a failed night is looked at the next day | host | two nights in a row succeed and one of them is verified |
| R6 | In the maintenance window: web in maintenance, **API and worker stopped**, then `backup.sh --final` | host | exit 0 (`quiet while taken: yes`, uploaded) |
| R7 | `verify-restore.sh` on that final backup | owner's machine | `VERIFIED <that id>` — only then does the upgrade's first changing step start |

R2 is the first step that reads production data and writes a file from it; it is not done until approved.

### Writers during the final backup and during a rollback

- The API and the worker each hold connections; the worker also purges the activity log on a timer. `--final`
  therefore requires both **stopped**, and checks it: any other session, or any row written while it ran, fails
  the backup. Provider dispatch is off in production, so no queued operation is in flight.
- A rollback restores into the production database with the same rule: API and worker stopped first, the web in
  maintenance, restore, then start the images that match the restored migrations. Redis is flushed of
  `session:*` keys only if sign-ins misbehave afterwards; sessions are re-made by signing in.

## 8. When something fails

| What failed | What it means | What to do | The upgrade |
|---|---|---|---|
| `backup.sh` exits non-zero | no usable backup was made (its last line says why) | fix the cause, run again; the previous backups are untouched | does not start |
| `--final` refuses (a session is connected, rows were written) | writers are still running | stop the API and the worker, run again | does not start |
| the upload fails | the backup exists on the host only | fix the storage, run again; do not treat the local file as the backup | does not start |
| `verify-restore.sh`: SHA-256 differs | the file changed between host and verifier | fetch again; if it still differs, take a new backup and investigate the storage | does not start |
| `verify-restore.sh`: cannot decrypt | wrong key, or a damaged file | check the key against an older backup; take a new backup | does not start |
| `verify-restore.sh`: a difference | the restore is not what was backed up | keep the file and the report; take a new backup; do not upgrade until one verifies | does not start |
| `rehearse-upgrade.sh` fails | the upgrade would fail or change data unexpectedly on this data | fix in code or plan first; rehearse again on a fresh copy | does not start |
| the nightly backup failed | last night has no backup | run by hand that day; two failed nights in a row are an incident | — |

No step that changes production data begins without `VERIFIED` for the backup taken immediately before it.

## 9. Results on synthetic data (2026-11-12)

A database built on the deployed commit's schema (49 migrations) with made-up rows: 6 accounts, 12 packages, 60
lines (14 with an eSIM code), 40 tasks (3 open), 80 sessions, 40 notices (20 with the old keys), a ledger.

- Backup: 77 kB encrypted, 29 tables, 49 migrations in the manifest; no clear text of the data in the file.
- Verify: restored and compared 29 tables, 49 migrations, 69 constraints, 66 indexes in 4 s — `VERIFIED`.
- Rehearsal: 49 → 58 migrations, none unfinished; 28 tables kept their rows; the new API started in production
  mode; sign-in, lists, an old eSIM code from the line detail, a 404 outside the tree, packages under new
  codes; dry run counted 14 line codes and 5 task codes clear — `REHEARSED`.
- The R2 path and the job (`testing/r2-cases.sh`, 28 cases, against the stand-in): stored as ciphertext and
  byte for byte the local file; fetched, restored with the right key, refused with another; the same backup
  sent twice succeeds and changes nothing; another file under an existing name, a clear dump, a file that is not
  its manifest's, are not uploaded; two server errors and a connection cut mid-upload are retried; an
  unreachable storage and a wrong credential fail, are logged and alerted, and the local copy stays; a second
  run is refused; a dead run's lock is taken over; stale and never-run hosts raise the alarm; the heartbeat is
  fetched; the drill records `VERIFIED` and alerts when it cannot restore.
- Two faults of the scripts found by these cases and fixed: a failed backup ended the job before it was logged
  or alerted; and re-sending a backup was refused because the manifest had been changed after the upload.
- 19 failure cases, all refused as they must be: a changed file; a damaged file with a rewritten manifest; a cut
  file; another private key; a manifest with one more row, with a different ledger checksum, with no
  migrations; a private key given as the public one; no disk space; no container; no database; a failed upload
  (the new file kept, nothing pruned); `--final` with no upload, and with a session connected; a backup under
  400 concurrent wallet moves (reported, and still restores to its own snapshot).
- One fault of the script itself was found by these cases and fixed: the "is the database quiet" checks read the
  container's default database, not the one being backed up.

**Found by the rehearsal, about the upgrade itself:** a session opened before the upgrade is **signed out** by
it. The migration keeps the row and gives it the hash of its old cookie, but the deployed version names the
live-session key in Redis `session:<row id>` and the new one looks for `session:<hash>`. Every account signs in
again after the upgrade. Inside a maintenance window this is acceptable (and it loads the new web for everyone);
the upgrade plan is corrected to say so.

## 10. Limits

- The content checksum reads every row; at today's 10 MB it is instant. `BACKUP_FINGERPRINT=counts` drops it when
  the database grows, at the price of comparing counts only.
- The synthetic rows are not the production rows: R4 on the real backup is the rehearsal that counts.
- The scripts were run with bash 3.2 (macOS) against `postgres:16`; the host has bash 5 and the same image. R2
  is their first run on Linux.
