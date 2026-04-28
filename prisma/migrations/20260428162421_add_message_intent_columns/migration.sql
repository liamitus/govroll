-- Demand-signal columns for the rep-mention chat feature. Populated on
-- user-sender Message rows when the client's intent detector matched a rep
-- in the user's reps-for-bill list. Null on assistant rows. Lets us answer
-- "how often do users actually ask 'why did X vote' on this platform?"
-- before deciding whether to invest in web-search-grounded rationale.
ALTER TABLE "Message"
  ADD COLUMN "mentionedRepBioguideId" TEXT,
  ADD COLUMN "wasWhyIntent" BOOLEAN NOT NULL DEFAULT false;

-- Demand-signal queries scan recent messages by intent or by rep, so we
-- index each independently. createdAt is the second key so the planner
-- can drive a time-windowed aggregate without a sort.
CREATE INDEX "Message_wasWhyIntent_createdAt_idx"
  ON "Message"("wasWhyIntent", "createdAt");

CREATE INDEX "Message_mentionedRepBioguideId_createdAt_idx"
  ON "Message"("mentionedRepBioguideId", "createdAt");
