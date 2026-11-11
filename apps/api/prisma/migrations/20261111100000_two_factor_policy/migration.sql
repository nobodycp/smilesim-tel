-- Two-step verification policy per layer and per account (spec 2026-11-11-two-factor-policy). Additive.
--   LayerPolicy.method: the method accounts of the layer enrol with while the layer is required.
--   User.twoFactorRequired: account mode "required" (twoFactorExempt stays mode "optional").
--   User.requiredMethod: the method this account must enrol with; null follows its layer.

ALTER TABLE "LayerPolicy" ADD COLUMN "method" TEXT NOT NULL DEFAULT 'app';
ALTER TABLE "User" ADD COLUMN "twoFactorRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "requiredMethod" TEXT;
