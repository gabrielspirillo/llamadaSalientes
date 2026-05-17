-- Switch default currency to EUR and migrate existing rows.

ALTER TABLE "treatments" ALTER COLUMN "currency" SET DEFAULT 'EUR';
UPDATE "treatments" SET "currency" = 'EUR' WHERE "currency" = 'USD';

ALTER TABLE "scheduling_offers" ALTER COLUMN "currency" SET DEFAULT 'EUR';
UPDATE "scheduling_offers" SET "currency" = 'EUR' WHERE "currency" = 'USD';
