-- Provider-level default run modes (flexible map; missing keys resolve to manual in app code).
ALTER TABLE "Provider" ADD COLUMN "actionModes" JSONB NOT NULL DEFAULT '{}';
