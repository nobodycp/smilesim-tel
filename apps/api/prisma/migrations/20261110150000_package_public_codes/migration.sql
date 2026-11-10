-- A package's public code named its provider (`sky-cellcom-400`) and every layer sees that code, although the
-- provider is the branch's business alone (backend-engineering.mdc 3.4; plan backend-loose-ends A.5).
-- The provider's own product code moves to "providerProductCode" where it was not kept yet, and the public code
-- becomes `<company>-<size>[-<months>m]-<five characters of the package's id>` (rules/package-code.ts).
-- Everything stored that quotes a code is renamed with it, through one old → new map.
-- One DO block: either all of it happens or none of it, however the migration runner splits statements.

DO $$
BEGIN
  UPDATE "Package" SET "providerProductCode" = "code" WHERE "providerProductCode" IS NULL;

  CREATE TEMP TABLE "_package_code_map" AS
  SELECT p."id",
         p."code" AS "old",
         coalesce(c."code", 'pkg') || '-' || coalesce(p."dataGb"::text || 'gb', 'pkg')
           || CASE WHEN p."months" > 1 THEN '-' || p."months" || 'm' ELSE '' END
           || '-' || substr(replace(p."id", '-', ''), 1, 5) AS "new"
  FROM "Package" p
  LEFT JOIN "Company" c ON c."id" = p."companyId";

  UPDATE "Package" p SET "code" = m."new" FROM "_package_code_map" m WHERE m."id" = p."id";

  -- A number keeps the code of its package and of each package it may renew onto.
  UPDATE "Line" l
  SET "terms" = jsonb_set(l."terms", '{packageCode}', to_jsonb(m."new"))
  FROM "_package_code_map" m
  WHERE l."terms" ->> 'packageCode' = m."old";

  UPDATE "Line" l
  SET "terms" = jsonb_set(l."terms", '{renewalTargets}', (
    SELECT coalesce(jsonb_agg(CASE WHEN m."new" IS NULL THEN x.target ELSE jsonb_set(x.target, '{code}', to_jsonb(m."new")) END ORDER BY x.place), '[]'::jsonb)
    FROM jsonb_array_elements(l."terms" -> 'renewalTargets') WITH ORDINALITY AS x(target, place)
    LEFT JOIN "_package_code_map" m ON m."old" = x.target ->> 'code'
  ))
  WHERE jsonb_typeof(l."terms" -> 'renewalTargets') = 'array' AND jsonb_array_length(l."terms" -> 'renewalTargets') > 0;

  -- The activity log names a package as `CODE`, and an account's terms on one as `LOGIN:CODE`.
  UPDATE "ActivityEvent" e SET "subjectRef" = m."new"
  FROM "_package_code_map" m
  WHERE e."subjectKind" = 'package' AND e."subjectRef" = m."old";

  UPDATE "ActivityEvent" e SET "subjectRef" = split_part(e."subjectRef", ':', 1) || ':' || m."new"
  FROM "_package_code_map" m
  WHERE e."subjectKind" = 'user' AND split_part(e."subjectRef", ':', 2) = m."old";

  DROP TABLE "_package_code_map";
END $$;
