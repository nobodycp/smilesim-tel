-- Search (plan 2026-11-17-database-scale, DB.6; audit 2026-11-17, section 8 and D.6). Indexes only: no row changes.
-- A plain CREATE INDEX: the tables are small today (spec 2026-11-17-scale-speed-cleanup).

-- `pg_trgm` ships with PostgreSQL (the official image and every packaged server) and is a trusted extension: the
-- owner of the database may create it without being a superuser (PostgreSQL 13 and later).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- A part of a number or of a serial (`contains`, LIKE '%…%'): the numbers list and the top bar, the inbox, finance.
-- A full number is a part too, so the same index serves it. The schema states these (`type: Gin`).
CREATE INDEX "Line_msisdn_trgm_idx" ON "Line" USING GIN ("msisdn" gin_trgm_ops);
CREATE INDEX "Line_iccid_trgm_idx" ON "Line" USING GIN ("iccid" gin_trgm_ops);
CREATE INDEX "Task_msisdn_trgm_idx" ON "Task" USING GIN ("msisdn" gin_trgm_ops);
CREATE INDEX "WalletEntry_msisdn_trgm_idx" ON "WalletEntry" USING GIN ("msisdn" gin_trgm_ops);
