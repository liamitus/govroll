-- Add Bill.sponsorBioguideId — bioguideId of the bill's sponsor when
-- Congress.gov returns one. Lets the rep card on a bill page link the
-- sponsor to a specific Representative row and surface "Sponsored this
-- bill" instead of treating the sponsor like an absent member.
--
-- Partial index — sparse column (sponsor is nullable, and many older
-- bills won't have a bioguideId at all), so we only index rows where
-- the column is set.

ALTER TABLE "Bill" ADD COLUMN "sponsorBioguideId" TEXT;
CREATE INDEX "Bill_sponsorBioguideId_idx" ON "Bill"("sponsorBioguideId") WHERE "sponsorBioguideId" IS NOT NULL;
