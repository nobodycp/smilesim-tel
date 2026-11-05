-- Package keeps its own copy of the provider action map. Existing rows stay empty and keep their boolean flags.
ALTER TABLE "Package" ADD COLUMN "actionModes" JSONB NOT NULL DEFAULT '{}';
