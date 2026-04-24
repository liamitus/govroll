-- CreateTable
CREATE TABLE "IngestCursor" (
    "key" TEXT NOT NULL,
    "cursor" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IngestCursor_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SummaryJob" (
    "versionId" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "errorMessage" TEXT,

    CONSTRAINT "SummaryJob_pkey" PRIMARY KEY ("versionId")
);

-- CreateIndex
CREATE INDEX "SummaryJob_status_idx" ON "SummaryJob"("status");

-- CreateIndex
CREATE INDEX "BillTextVersion_versionDate_idx" ON "BillTextVersion"("versionDate");

-- AddForeignKey
ALTER TABLE "SummaryJob" ADD CONSTRAINT "SummaryJob_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "BillTextVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enable RLS on the new tables to match existing ones
ALTER TABLE "IngestCursor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SummaryJob" ENABLE ROW LEVEL SECURITY;
