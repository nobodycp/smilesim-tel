-- The fingerprint of a database: what it holds, without any of it. One fact per line (`kind|name|…`), so two
-- fingerprints are compared with `diff`. Run by psql with `-At -F '|' -v mode=full|counts`, inside the caller's
-- transaction. `full` adds a checksum of every table's content; `counts` only counts rows.
set local timezone = 'UTC';
set local datestyle = 'ISO, YMD';
set local extra_float_digits = 3;
set local bytea_output = 'hex';
select format(
         'select %L, count(*)%s from %I.%I t',
         'table|' || c.relname,
         case when :'mode' = 'full'
              then ', md5(coalesce(string_agg(md5(t::text), '''' order by md5(t::text)), ''''))'
              else '' end,
         n.nspname, c.relname)
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where c.relkind = 'r' and n.nspname = 'public'
order by c.relname
\gexec
select 'migration|' || migration_name, (finished_at is not null)::text, (rolled_back_at is not null)::text
from _prisma_migrations order by migration_name;
select 'constraint|' || conrelid::regclass::text || '.' || conname, contype::text, convalidated::text
from pg_constraint where connamespace = 'public'::regnamespace order by 1;
select 'index|' || indexname, md5(indexdef) from pg_indexes where schemaname = 'public' order by 1;
select 'trigger|' || event_object_table || '.' || trigger_name, string_agg(event_manipulation, ',' order by event_manipulation)
from information_schema.triggers where trigger_schema = 'public' group by 1 order by 1;
select 'column|' || table_name || '.' || column_name, data_type, is_nullable
from information_schema.columns where table_schema = 'public' order by 1;
select 'sequence|' || sequencename, coalesce(last_value::text, '-') from pg_sequences where schemaname = 'public' order by 1;
