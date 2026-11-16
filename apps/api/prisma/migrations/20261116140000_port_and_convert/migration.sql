-- Number porting and prepaid-to-bill conversion as ways to activate a number on a package (spec
-- 2026-11-16-package-page, P.5). Off for every package, old and new, until the branch turns it on.
ALTER TABLE "Package" ADD COLUMN "portMode" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "Package" ADD COLUMN "convertMode" TEXT NOT NULL DEFAULT 'off';
ALTER TABLE "Package" ADD CONSTRAINT "Package_portMode_check" CHECK ("portMode" IN ('off', 'manual', 'auto'));
ALTER TABLE "Package" ADD CONSTRAINT "Package_convertMode_check" CHECK ("convertMode" IN ('off', 'manual', 'auto'));

-- Which of the two an activation task is; empty for an ordinary activation and for every other action.
ALTER TABLE "Task" ADD COLUMN "activationKind" TEXT;
ALTER TABLE "Task" ADD CONSTRAINT "Task_activationKind_check" CHECK ("activationKind" IS NULL OR "activationKind" IN ('port', 'convert'));
