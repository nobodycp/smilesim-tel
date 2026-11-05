-- How a company's SIMs look: activation and SIM swap refuse an ICCID that does not fit.
ALTER TABLE "Company" ADD COLUMN "iccidLength" INTEGER;
ALTER TABLE "Company" ADD COLUMN "iccidPrefix" TEXT;
ALTER TABLE "Company" ADD COLUMN "esim" BOOLEAN NOT NULL DEFAULT true;
