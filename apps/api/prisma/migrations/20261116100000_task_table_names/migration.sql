-- The tables of the `Task` and `TaskNote` models take the models' names (owner, 2026-11-16: no name of the old
-- `office` is to stay). Names only: no column, row, type or rule changes. Every constraint and index whose name
-- began with the old table name is renamed the same way (a primary key's or a unique constraint's index is
-- renamed with its constraint), so the names are what Prisma derives from the models.
ALTER TABLE "OfficeTaskNote" RENAME TO "TaskNote";
ALTER TABLE "OfficeTask" RENAME TO "Task";

DO $$
DECLARE item record;
BEGIN
  FOR item IN
    SELECT c.conname AS name, t.relname AS on_table
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = current_schema() AND c.conname LIKE 'OfficeTask%'
  LOOP
    EXECUTE format('ALTER TABLE %I RENAME CONSTRAINT %I TO %I', item.on_table, item.name, substr(item.name, 7));
  END LOOP;
  FOR item IN
    SELECT indexname AS name FROM pg_indexes WHERE schemaname = current_schema() AND indexname LIKE 'OfficeTask%'
  LOOP
    EXECUTE format('ALTER INDEX %I RENAME TO %I', item.name, substr(item.name, 7));
  END LOOP;
END $$;
