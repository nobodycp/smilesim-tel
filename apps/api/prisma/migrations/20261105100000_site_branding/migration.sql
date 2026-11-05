-- Office identity: one row (id = 1) the branch owner edits from /branding.
CREATE TABLE "SiteBranding" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "siteName" TEXT NOT NULL DEFAULT '',
  "tagline" TEXT NOT NULL DEFAULT '',
  "logo" TEXT,
  "logoDark" TEXT,
  "favicon" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SiteBranding_pkey" PRIMARY KEY ("id")
);
