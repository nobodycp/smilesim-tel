-- Every line of a task's log carries its time (`tasks/task-log.ts` has stamped each line it writes since
-- 2026-11-03). Lines written before that have none, and the reader gave them the task's creation time. This gives
-- those lines that time in the row itself, so the reader no longer needs the fallback. Blank lines go. Nothing else
-- of a task changes; `updatedAt` is not moved.
UPDATE "Task" t
SET "log" = COALESCE((
  SELECT string_agg(
    CASE WHEN btrim(x.line) ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z\s+\S'
      THEN btrim(x.line)
      ELSE to_char(t."createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || ' ' || btrim(x.line)
    END, E'\n' ORDER BY x.ord)
  FROM regexp_split_to_table(t."log", E'\n') WITH ORDINALITY AS x(line, ord)
  WHERE btrim(x.line) <> ''
), '')
WHERE t."log" <> '' AND EXISTS (
  SELECT 1 FROM regexp_split_to_table(t."log", E'\n') AS y(line)
  WHERE btrim(y.line) = '' OR btrim(y.line) !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z\s+\S'
);
