UPDATE "Event"
SET "capacity" = 45
WHERE "slug" = 'brunch-mangais';

UPDATE "Route"
SET "capacity" = 45
WHERE "eventId" IN (
  SELECT "id"
  FROM "Event"
  WHERE "slug" = 'brunch-mangais'
);
