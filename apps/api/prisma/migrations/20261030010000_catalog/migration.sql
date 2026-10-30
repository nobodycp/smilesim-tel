-- Companies sit under a provider. A package belongs to one company.

CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Company_code_key" ON "Company"("code");

ALTER TABLE "Company" ADD CONSTRAINT "Company_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Package" ADD COLUMN "companyId" TEXT;
ALTER TABLE "Package" ADD COLUMN "dataGb" INTEGER;
ALTER TABLE "Package" ADD COLUMN "months" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Package" ADD CONSTRAINT "Package_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
