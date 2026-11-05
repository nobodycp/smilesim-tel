-- Shekels become agorot (1 shekel = 100). Existing whole-shekel rows scale once.

ALTER TABLE "WalletEntry" ADD COLUMN "providerCost" INTEGER;

UPDATE "Wallet" SET "balance" = "balance" * 100, "ceiling" = "ceiling" * 100;
UPDATE "WalletEntry" SET
  "amount" = "amount" * 100,
  "balanceAfter" = "balanceAfter" * 100,
  "packagePrice" = CASE WHEN "packagePrice" IS NULL THEN NULL ELSE "packagePrice" * 100 END;
UPDATE "Package" SET
  "branchCost" = "branchCost" * 100,
  "mainPrice" = "mainPrice" * 100,
  "agentPrice" = "agentPrice" * 100,
  "posPrice" = "posPrice" * 100,
  "subscriberPrice" = "subscriberPrice" * 100,
  "renewalBranchCost" = "renewalBranchCost" * 100,
  "renewalMainPrice" = "renewalMainPrice" * 100,
  "renewalAgentPrice" = "renewalAgentPrice" * 100,
  "renewalPosPrice" = "renewalPosPrice" * 100,
  "renewalSubscriberPrice" = "renewalSubscriberPrice" * 100;
UPDATE "PackageOffer" SET "price" = "price" * 100;
UPDATE "OfficeTask" SET "posDelta" = "posDelta" * 100;

CREATE FUNCTION scale_prices(obj jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN obj IS NULL OR obj = 'null'::jsonb THEN obj
    ELSE obj || jsonb_build_object(
      'branchCost', round(COALESCE((obj->>'branchCost')::numeric, 0) * 100),
      'mainPrice', round(COALESCE((obj->>'mainPrice')::numeric, 0) * 100),
      'agentPrice', round(COALESCE((obj->>'agentPrice')::numeric, 0) * 100),
      'posPrice', round(COALESCE((obj->>'posPrice')::numeric, 0) * 100),
      'subscriberPrice', round(COALESCE((obj->>'subscriberPrice')::numeric, 0) * 100)
    )
  END;
$$;

UPDATE "Line"
SET "terms" = "terms" || jsonb_build_object(
  'subscription', scale_prices("terms"->'subscription'),
  'renewal', scale_prices("terms"->'renewal'),
  'renewalTargets', COALESCE((
    SELECT jsonb_agg(jsonb_set(item, '{renewal}', scale_prices(item->'renewal')))
    FROM jsonb_array_elements(COALESCE("terms"->'renewalTargets', '[]'::jsonb)) AS item
  ), '[]'::jsonb)
);

DROP FUNCTION scale_prices(jsonb);
