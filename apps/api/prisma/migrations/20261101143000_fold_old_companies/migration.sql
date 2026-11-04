INSERT INTO "Company" ("id", "code", "name")
VALUES
  (gen_random_uuid(), 'cellcom', 'سلكوم'),
  (gen_random_uuid(), 'wecom', 'ويكوم'),
  (gen_random_uuid(), 'alloha', 'الوها'),
  (gen_random_uuid(), 'pelephone', 'بليفون'),
  (gen_random_uuid(), 'partner', 'بارتنر'),
  (gen_random_uuid(), 'hot', 'هوت موبايل'),
  (gen_random_uuid(), 'rami', 'رامي ليفي'),
  (gen_random_uuid(), '019', '019'),
  (gen_random_uuid(), 'kalam', 'كلام'),
  (gen_random_uuid(), 'symphony', 'سيمفوني'),
  (gen_random_uuid(), 'sky', 'سكاي')
ON CONFLICT ("code") DO UPDATE SET "name" = EXCLUDED."name";

UPDATE "Package" AS package
SET "companyId" = shelf."id"
FROM "Company" AS old
JOIN (
  VALUES
    ('sky-cellcom', 'cellcom'),
    ('aren-cellcom', 'cellcom'),
    ('quickline-cellcom', 'cellcom'),
    ('alloha-cellcom', 'cellcom'),
    ('lian-wecom', 'wecom'),
    ('aren-wecom', 'wecom'),
    ('alloha-wecom', 'wecom'),
    ('alloha-alloha', 'alloha'),
    ('sky-pelephone', 'pelephone'),
    ('lian-partner', 'partner'),
    ('sky-hot', 'hot'),
    ('lian-hot', 'hot'),
    ('lian-rami', 'rami'),
    ('lian-019', '019')
) AS map(old_code, shelf_code) ON old."code" = map.old_code
JOIN "Company" AS shelf ON shelf."code" = map.shelf_code
WHERE package."companyId" = old."id";

UPDATE "Package"
SET
  "branchCost" = 38,
  "mainPrice" = 38,
  "agentPrice" = 38,
  "posPrice" = 38,
  "subscriberPrice" = 38,
  "renewalBranchCost" = 38,
  "renewalMainPrice" = 38,
  "renewalAgentPrice" = 38,
  "renewalPosPrice" = 38,
  "renewalSubscriberPrice" = 38
WHERE "code" = 'sky-hot-150';

INSERT INTO "Package" (
  "id", "code", "name", "providerId", "companyId", "dataGb", "months",
  "branchCost", "mainPrice", "agentPrice", "posPrice", "subscriberPrice",
  "forSale",
  "renewalBranchCost", "renewalMainPrice", "renewalAgentPrice", "renewalPosPrice", "renewalSubscriberPrice",
  "autoActivate", "autoCharge", "autoDisconnect", "autoFreeze", "autoSwitch",
  "autoExtend", "autoRename", "autoSim",
  "allowActivate", "allowCharge", "allowDisconnect", "allowFreeze", "allowSwitch",
  "allowExtend", "allowRename", "allowSim",
  "enabled"
)
SELECT
  gen_random_uuid(), 'sky-hot-200', '200 جيجا', source."providerId", hot."id", 200, 1,
  40, 40, 40, 40, 40,
  true,
  40, 40, 40, 40, 40,
  source."autoActivate", source."autoCharge", source."autoDisconnect", source."autoFreeze", source."autoSwitch",
  source."autoExtend", source."autoRename", source."autoSim",
  source."allowActivate", source."allowCharge", source."allowDisconnect", source."allowFreeze", source."allowSwitch",
  source."allowExtend", source."allowRename", source."allowSim",
  source."enabled"
FROM "Package" AS source
JOIN "Company" AS hot ON hot."code" = 'hot'
WHERE source."code" = 'sky-hot-300'
  AND NOT EXISTS (SELECT 1 FROM "Package" WHERE "code" = 'sky-hot-200');

DELETE FROM "Company"
WHERE "code" NOT IN (
  'cellcom', 'wecom', 'alloha', 'pelephone', 'partner', 'hot', 'rami', '019', 'kalam', 'symphony', 'sky'
);
