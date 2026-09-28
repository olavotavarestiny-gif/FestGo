-- Additive session revision used to invalidate existing sessions after an
-- administrator password is changed or recovered.
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1;
