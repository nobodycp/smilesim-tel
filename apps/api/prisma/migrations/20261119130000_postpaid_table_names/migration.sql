-- The ten postpaid models and their tables take the prefix `Postpaid` (spec 2026-11-19-business-lines-foundation,
-- F.7 / F.7a "Models and tables"; ADR 0028). Names only: no column, row, type or rule changes.
--
-- Every constraint (primary key, foreign key, CHECK, NOT NULL) and every index OWNED BY one of the ten tables whose
-- name begins with the old table name and an underscore is renamed with it, so the names are what Prisma derives
-- from the renamed models. Renaming a primary key renames its index. Constraints owned by the shared tables keep
-- their names even when they point at a renamed table (`WalletEntry_lineId_fkey`, `Task_packageId_fkey`, ...).
-- Storage options (`autovacuum_*`), comments, grants and dependent objects follow a table on RENAME.
--
-- One DO block on purpose: `migrate deploy` runs a file's statements one by one with no surrounding transaction, and
-- a single statement is atomic, so the database is either fully renamed or not at all.
DO $$
DECLARE
  pair text[];
  old_name text;
  new_name text;
  new_item text;
  item record;
BEGIN
  FOREACH pair SLICE 1 IN ARRAY ARRAY[
    ['Company', 'PostpaidCompany'],
    ['Package', 'PostpaidPackage'],
    ['PackageDuration', 'PostpaidPackageDuration'],
    ['PackageRenewal', 'PostpaidPackageRenewal'],
    ['PackageSwitch', 'PostpaidPackageSwitch'],
    ['PackageAddon', 'PostpaidPackageAddon'],
    ['UserPackage', 'PostpaidUserPackage'],
    ['SellPrice', 'PostpaidSellPrice'],
    ['Line', 'PostpaidLine'],
    ['LineCountSnapshot', 'PostpaidLineCountSnapshot']
  ]
  LOOP
    old_name := pair[1];
    new_name := pair[2];
    EXECUTE format('ALTER TABLE %I.%I RENAME TO %I', current_schema(), old_name, new_name);

    FOR item IN
      SELECT c.conname AS name
      FROM pg_constraint c
      WHERE c.conrelid = format('%I.%I', current_schema(), new_name)::regclass
        AND left(c.conname, length(old_name) + 1) = old_name || '_'
    LOOP
      new_item := new_name || substr(item.name, length(old_name) + 1);
      IF length(new_item) > 63 THEN
        RAISE EXCEPTION 'name too long for PostgreSQL: %', new_item;
      END IF;
      EXECUTE format('ALTER TABLE %I.%I RENAME CONSTRAINT %I TO %I', current_schema(), new_name, item.name, new_item);
    END LOOP;

    FOR item IN
      SELECT i.relname AS name
      FROM pg_index x JOIN pg_class i ON i.oid = x.indexrelid
      WHERE x.indrelid = format('%I.%I', current_schema(), new_name)::regclass
        AND left(i.relname, length(old_name) + 1) = old_name || '_'
    LOOP
      new_item := new_name || substr(item.name, length(old_name) + 1);
      IF length(new_item) > 63 THEN
        RAISE EXCEPTION 'name too long for PostgreSQL: %', new_item;
      END IF;
      EXECUTE format('ALTER INDEX %I.%I RENAME TO %I', current_schema(), item.name, new_item);
    END LOOP;
  END LOOP;
END $$;
