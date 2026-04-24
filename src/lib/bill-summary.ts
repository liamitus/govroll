import { prisma } from "@/lib/prisma";
import { generateChangeSummary } from "@/lib/ai";
import { recordSpend } from "@/lib/budget";
import { assertAiEnabled, AiDisabledError } from "@/lib/ai-gate";
import { reportError } from "@/lib/error-reporting";

const BASELINE_SUMMARY = "Initial version of the bill as introduced.";
const TEXT_UNAVAILABLE =
  "Text comparison unavailable — one or both versions are missing full text.";

// If a job has been "pending" for longer than this, we consider it abandoned
// (e.g. the Fluid instance crashed mid-generation) and let the next caller
// retry instead of showing the user a perpetual spinner.
const STALE_PENDING_MS = 2 * 60_000;

export type SummaryState =
  | {
      status: "ready";
      summary: string;
      versionCode: string;
      versionType: string;
      versionDate: string;
    }
  | {
      status: "pending";
      versionCode: string;
      versionType: string;
      versionDate: string;
      startedAt: string;
    }
  | {
      status: "disabled";
      reason: "budget" | "manual";
    }
  | {
      status: "error";
      error: string;
      versionCode: string;
      versionType: string;
      versionDate: string;
    }
  | {
      status: "none";
    };

async function loadLatestSubstantiveVersion(billId: number) {
  return prisma.billTextVersion.findFirst({
    where: { billId, isSubstantive: true },
    orderBy: { versionDate: "desc" },
    select: {
      id: true,
      versionCode: true,
      versionType: true,
      versionDate: true,
      changeSummary: true,
      fullText: true,
    },
  });
}

/**
 * Ensures a SummaryJob exists for the latest substantive version of the bill
 * and returns the current state. Safe to call repeatedly — if a non-stale
 * pending job already exists, this is a no-op read.
 *
 * Returns `{ started: true, versionId }` when the caller should actually kick
 * off generation (via `waitUntil(generateSummaryForVersion(versionId))`).
 */
export async function ensureSummaryJob(billId: number): Promise<
  | { started: false; state: SummaryState }
  | {
      started: true;
      versionId: number;
      state: Extract<SummaryState, { status: "pending" }>;
    }
  | { started: false; state: Extract<SummaryState, { status: "disabled" }> }
> {
  const version = await loadLatestSubstantiveVersion(billId);
  if (!version) {
    return { started: false, state: { status: "none" } };
  }

  if (version.changeSummary) {
    return {
      started: false,
      state: {
        status: "ready",
        summary: version.changeSummary,
        versionCode: version.versionCode,
        versionType: version.versionType,
        versionDate: version.versionDate.toISOString(),
      },
    };
  }

  // Check an existing job row before we touch the budget — avoids unnecessary
  // reads when another viewer is already generating this version.
  const existing = await prisma.summaryJob.findUnique({
    where: { versionId: version.id },
  });
  const isStalePending =
    existing?.status === "pending" &&
    Date.now() - existing.startedAt.getTime() > STALE_PENDING_MS;

  if (existing && existing.status === "pending" && !isStalePending) {
    return {
      started: false,
      state: {
        status: "pending",
        versionCode: version.versionCode,
        versionType: version.versionType,
        versionDate: version.versionDate.toISOString(),
        startedAt: existing.startedAt.toISOString(),
      },
    };
  }

  // Check budget before acquiring the job row.
  try {
    await assertAiEnabled("bill_summary");
  } catch (e) {
    if (e instanceof AiDisabledError) {
      return {
        started: false,
        state: { status: "disabled", reason: e.reason },
      };
    }
    throw e;
  }

  // Upsert the job row into "pending" and start generation. The upsert is
  // safe under concurrent viewers — whichever request wins the row becomes
  // the generator; the others read "pending" on their next poll.
  const now = new Date();
  await prisma.summaryJob.upsert({
    where: { versionId: version.id },
    update: {
      status: "pending",
      startedAt: now,
      completedAt: null,
      errorMessage: null,
    },
    create: {
      versionId: version.id,
      status: "pending",
      startedAt: now,
    },
  });

  return {
    started: true,
    versionId: version.id,
    state: {
      status: "pending",
      versionCode: version.versionCode,
      versionType: version.versionType,
      versionDate: version.versionDate.toISOString(),
      startedAt: now.toISOString(),
    },
  };
}

/**
 * Generate a single version's change summary end-to-end, persist it to
 * BillTextVersion.changeSummary, and flip the SummaryJob row to "ready".
 * Designed for `waitUntil` use — it swallows errors after recording them to
 * the job row and the error reporter, so the background task never crashes
 * the parent Function instance.
 */
export async function generateSummaryForVersion(
  versionId: number,
): Promise<void> {
  try {
    const version = await prisma.billTextVersion.findUnique({
      where: { id: versionId },
      include: { bill: { select: { id: true, title: true } } },
    });
    if (!version) {
      await markJobError(versionId, "version not found");
      return;
    }
    if (version.changeSummary) {
      await markJobReady(versionId);
      return;
    }

    const previous = await prisma.billTextVersion.findFirst({
      where: {
        billId: version.billId,
        versionDate: { lt: version.versionDate },
      },
      orderBy: { versionDate: "desc" },
      select: { versionType: true, fullText: true },
    });

    if (!previous) {
      await writeSummary(versionId, BASELINE_SUMMARY);
      return;
    }

    if (!previous.fullText || !version.fullText) {
      await writeSummary(versionId, TEXT_UNAVAILABLE);
      return;
    }

    const result = await generateChangeSummary(
      version.bill.title,
      previous.fullText,
      version.fullText,
      previous.versionType,
      version.versionType,
    );

    await writeSummary(versionId, result.content);

    for (const u of result.usage) {
      await recordSpend({
        feature: "bill_summary",
        model: u.model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
      });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markJobError(versionId, msg);
    reportError(err instanceof Error ? err : new Error(msg), {
      route: "generateSummaryForVersion",
      versionId,
    });
  }
}

async function writeSummary(versionId: number, summary: string) {
  await prisma.billTextVersion.update({
    where: { id: versionId },
    data: { changeSummary: summary },
  });
  await markJobReady(versionId);
}

async function markJobReady(versionId: number) {
  await prisma.summaryJob.upsert({
    where: { versionId },
    update: {
      status: "ready",
      completedAt: new Date(),
      errorMessage: null,
    },
    create: {
      versionId,
      status: "ready",
      completedAt: new Date(),
    },
  });
}

async function markJobError(versionId: number, message: string) {
  await prisma.summaryJob.upsert({
    where: { versionId },
    update: {
      status: "error",
      completedAt: new Date(),
      errorMessage: message.slice(0, 500),
    },
    create: {
      versionId,
      status: "error",
      completedAt: new Date(),
      errorMessage: message.slice(0, 500),
    },
  });
}
