// Human-readable helpers for bill types, statuses, and legislative journey

/**
 * Format a journey-step date in UTC, not the viewer's local timezone.
 *
 * Action dates are stored as UTC midnight (e.g. 2026-04-13T00:00:00Z). When
 * rendered with `dayjs(iso).format(…)` they get shifted into local time, so
 * a US viewer sees "Apr 12" for an Apr 13 action. We always want the
 * calendar date that Congress.gov reports, so format in UTC.
 */
export function formatJourneyDate(
  iso: string,
  style: "short" | "long",
): string {
  const d = new Date(iso);
  const options: Intl.DateTimeFormatOptions =
    style === "long"
      ? { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }
      : { month: "short", day: "numeric", timeZone: "UTC" };
  return new Intl.DateTimeFormat("en-US", options).format(d);
}

export interface JourneyStep {
  label: string;
  description: string;
  status: "completed" | "current" | "upcoming" | "failed";
  date?: string;
  detail?: string;
}

interface BillTypeInfo {
  label: string;
  shortLabel: string;
  description: string;
  becomesLaw: boolean;
}

const BILL_TYPES: Record<string, BillTypeInfo> = {
  house_bill: {
    label: "House Bill",
    shortLabel: "H.R.",
    description:
      "A proposed law introduced in the House of Representatives. Must pass both chambers of Congress and be signed by the President to become law.",
    becomesLaw: true,
  },
  senate_bill: {
    label: "Senate Bill",
    shortLabel: "S.",
    description:
      "A proposed law introduced in the Senate. Must pass both chambers of Congress and be signed by the President to become law.",
    becomesLaw: true,
  },
  house_resolution: {
    label: "House Resolution",
    shortLabel: "H.Res.",
    description:
      "A measure addressing internal House matters or expressing the sentiment of the House. Only needs to pass the House — it does not go to the Senate or the President, and does not become law.",
    becomesLaw: false,
  },
  senate_resolution: {
    label: "Senate Resolution",
    shortLabel: "S.Res.",
    description:
      "A measure addressing internal Senate matters or expressing the sentiment of the Senate. Only needs to pass the Senate — it does not go to the House or the President, and does not become law.",
    becomesLaw: false,
  },
  house_joint_resolution: {
    label: "House Joint Resolution",
    shortLabel: "H.J.Res.",
    description:
      "Functions like a bill and can become law. Also used to propose constitutional amendments, which require a two-thirds vote in both chambers.",
    becomesLaw: true,
  },
  senate_joint_resolution: {
    label: "Senate Joint Resolution",
    shortLabel: "S.J.Res.",
    description:
      "Functions like a bill and can become law. Also used to propose constitutional amendments, which require a two-thirds vote in both chambers.",
    becomesLaw: true,
  },
  house_concurrent_resolution: {
    label: "House Concurrent Resolution",
    shortLabel: "H.Con.Res.",
    description:
      "Expresses the shared position of both chambers on a matter. Must pass both the House and Senate, but does not go to the President and does not become law.",
    becomesLaw: false,
  },
  senate_concurrent_resolution: {
    label: "Senate Concurrent Resolution",
    shortLabel: "S.Con.Res.",
    description:
      "Expresses the shared position of both chambers on a matter. Must pass both the House and Senate, but does not go to the President and does not become law.",
    becomesLaw: false,
  },
};

export function getBillTypeInfo(billType: string): BillTypeInfo {
  return (
    BILL_TYPES[billType] || {
      label: billType
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase()),
      shortLabel: billType,
      description: "A piece of legislation before Congress.",
      becomesLaw: false,
    }
  );
}

function isSimpleResolution(billType: string): boolean {
  return billType === "house_resolution" || billType === "senate_resolution";
}

function isConcurrentResolution(billType: string): boolean {
  return (
    billType === "house_concurrent_resolution" ||
    billType === "senate_concurrent_resolution"
  );
}

function getOriginChamber(billType: string): string {
  return billType.startsWith("house") ? "House" : "Senate";
}

function getOtherChamber(billType: string): string {
  return billType.startsWith("house") ? "Senate" : "House";
}

interface StatusPosition {
  stepIndex: number;
  isFailed: boolean;
}

/**
 * Maps a GovTrack current_status + billType to the correct journey step index
 * and whether the bill died at that step.
 *
 * For bills/joint resolutions (4-step journey):
 *   0: Introduced  1: Passed Origin  2: Passed Other  3: Became Law
 *
 * Key insight: `pass_over_house` means "passed the House" regardless of bill
 * origin. For a house_bill that's step 1 (origin); for a senate_bill it's
 * step 2 (other chamber). Same logic inverted for `pass_over_senate`.
 */
function getStatusPosition(
  currentStatus: string,
  billType: string,
): StatusPosition {
  const originIsHouse = billType.startsWith("house");

  // Enacted — all steps completed
  if (currentStatus.startsWith("enacted_"))
    return { stepIndex: Infinity, isFailed: false };

  // Passed both chambers, awaiting president
  if (
    currentStatus === "passed_bill" ||
    currentStatus.startsWith("conference_")
  )
    return { stepIndex: 3, isFailed: false };

  // Concurrent resolution cleared both chambers — it doesn't go to the
  // President, so all of its steps are complete.
  if (currentStatus === "passed_concurrentres")
    return { stepIndex: Infinity, isFailed: false };

  // Simple resolution cleared its origin — it's done, one chamber only.
  if (currentStatus === "passed_simpleres")
    return { stepIndex: Infinity, isFailed: false };

  // Passed one chamber
  if (currentStatus === "pass_over_house")
    return { stepIndex: originIsHouse ? 1 : 2, isFailed: false };
  if (currentStatus === "pass_over_senate")
    return { stepIndex: originIsHouse ? 2 : 1, isFailed: false };

  // Ping-pong — both chambers have acted, reconciling
  if (
    currentStatus === "pass_back_house" ||
    currentStatus === "pass_back_senate"
  )
    return { stepIndex: 2, isFailed: false };

  // Introduced / committee stage
  if (currentStatus === "introduced" || currentStatus === "reported")
    return { stepIndex: 0, isFailed: false };

  // --- Failed / killed statuses ---

  // Failed in a specific chamber
  if (currentStatus === "fail_originating_house")
    return { stepIndex: originIsHouse ? 1 : 2, isFailed: true };
  if (currentStatus === "fail_originating_senate")
    return { stepIndex: originIsHouse ? 2 : 1, isFailed: true };
  if (
    currentStatus === "fail_second_house" ||
    currentStatus === "fail_second_senate"
  )
    return { stepIndex: 2, isFailed: true };

  // Cloture failure is always Senate; suspension failure is always House
  if (currentStatus === "prov_kill_cloturefailed")
    return { stepIndex: originIsHouse ? 2 : 1, isFailed: true };
  if (currentStatus === "prov_kill_suspensionfailed")
    return { stepIndex: originIsHouse ? 1 : 2, isFailed: true };

  // Ping-pong reconciliation failure
  if (currentStatus === "prov_kill_pingpongfail")
    return { stepIndex: 2, isFailed: true };

  // Presidential veto and veto-related failures
  if (
    currentStatus === "prov_kill_veto" ||
    currentStatus === "vetoed_pocket" ||
    currentStatus.startsWith("vetoed_override_fail_")
  )
    return { stepIndex: 3, isFailed: true };

  // Fallback — treat unknown as introduced
  return { stepIndex: 0, isFailed: false };
}

/**
 * Position mapping for the six-stop bill route (Roll Call): Introduced →
 * Reported by Committee → Passed origin → Passed other → Presidential
 * signature → Became Law. Resolutions keep their shorter templates and the
 * legacy mapping above.
 *
 * The returned index marks the last stop the bill has CLEARED — the route
 * renders it as the gold "current position" node, so `passed_bill` sits on
 * "Presidential signature" (it is at the President's desk), and a veto is
 * that same stop failed.
 */
function getBillStatusPosition(
  currentStatus: string,
  billType: string,
): StatusPosition {
  const originIsHouse = billType.startsWith("house");
  const passedOrigin = 2;
  const passedOther = 3;

  if (currentStatus.startsWith("enacted_"))
    return { stepIndex: Infinity, isFailed: false };

  // Passed both chambers, at the President's desk
  if (
    currentStatus === "passed_bill" ||
    currentStatus.startsWith("conference_")
  )
    return { stepIndex: 4, isFailed: false };

  if (currentStatus === "pass_over_house")
    return {
      stepIndex: originIsHouse ? passedOrigin : passedOther,
      isFailed: false,
    };
  if (currentStatus === "pass_over_senate")
    return {
      stepIndex: originIsHouse ? passedOther : passedOrigin,
      isFailed: false,
    };

  // Ping-pong — both chambers have acted, reconciling
  if (
    currentStatus === "pass_back_house" ||
    currentStatus === "pass_back_senate"
  )
    return { stepIndex: passedOther, isFailed: false };

  if (currentStatus === "reported") return { stepIndex: 1, isFailed: false };
  if (currentStatus === "introduced") return { stepIndex: 0, isFailed: false };

  // --- Failed / killed statuses ---
  if (currentStatus === "fail_originating_house")
    return {
      stepIndex: originIsHouse ? passedOrigin : passedOther,
      isFailed: true,
    };
  if (currentStatus === "fail_originating_senate")
    return {
      stepIndex: originIsHouse ? passedOther : passedOrigin,
      isFailed: true,
    };
  if (
    currentStatus === "fail_second_house" ||
    currentStatus === "fail_second_senate"
  )
    return { stepIndex: passedOther, isFailed: true };

  // Cloture failure is always Senate; suspension failure is always House
  if (currentStatus === "prov_kill_cloturefailed")
    return {
      stepIndex: originIsHouse ? passedOther : passedOrigin,
      isFailed: true,
    };
  if (currentStatus === "prov_kill_suspensionfailed")
    return {
      stepIndex: originIsHouse ? passedOrigin : passedOther,
      isFailed: true,
    };

  if (currentStatus === "prov_kill_pingpongfail")
    return { stepIndex: passedOther, isFailed: true };

  // Presidential veto and veto-related failures die at the signature stop
  if (
    currentStatus === "prov_kill_veto" ||
    currentStatus === "vetoed_pocket" ||
    currentStatus.startsWith("vetoed_override_fail_")
  )
    return { stepIndex: 4, isFailed: true };

  return { stepIndex: 0, isFailed: false };
}

function markSteps(
  steps: Omit<JourneyStep, "status">[],
  position: StatusPosition,
): JourneyStep[] {
  // For enacted bills, stepIndex is Infinity so all steps are completed
  const completedUpTo = Math.min(position.stepIndex, steps.length);

  return steps.map((step, i) => ({
    ...step,
    status:
      position.isFailed && i === completedUpTo
        ? "failed"
        : i < completedUpTo
          ? "completed"
          : i === completedUpTo
            ? "current"
            : "upcoming",
  }));
}

export function getJourneySteps(
  billType: string,
  currentStatus: string,
): JourneyStep[] {
  const origin = getOriginChamber(billType);
  const position = getStatusPosition(currentStatus, billType);

  if (isSimpleResolution(billType)) {
    const steps = [
      { label: "Introduced", description: `Filed in the ${origin}` },
      { label: `Passed ${origin}`, description: `Adopted by the ${origin}` },
    ];
    return markSteps(steps, position);
  }

  if (isConcurrentResolution(billType)) {
    const other = getOtherChamber(billType);
    const steps = [
      { label: "Introduced", description: `Filed in the ${origin}` },
      { label: `Passed ${origin}`, description: `Adopted by the ${origin}` },
      { label: `Passed ${other}`, description: `Adopted by the ${other}` },
    ];
    return markSteps(steps, position);
  }

  // Bills and joint resolutions — the six-stop route (Roll Call §8):
  // a bill is a route with fixed stops and a terminus.
  const other = getOtherChamber(billType);
  const steps = [
    { label: "Introduced", description: `Filed in the ${origin}` },
    {
      label: "Reported by Committee",
      description: "Advanced out of committee",
    },
    { label: `Passed ${origin}`, description: `Approved by the ${origin}` },
    { label: `Passed ${other}`, description: `Approved by the ${other}` },
    {
      label: "Presidential signature",
      description: "Awaiting the President's signature",
    },
    { label: "Became Law", description: "Signed by the President" },
  ];

  return markSteps(steps, getBillStatusPosition(currentStatus, billType));
}

export function getStatusExplanation(
  billType: string,
  currentStatus: string,
): { headline: string; detail: string } {
  const typeInfo = getBillTypeInfo(billType);
  const origin = getOriginChamber(billType);
  const other = getOtherChamber(billType);

  if (currentStatus === "introduced") {
    if (isSimpleResolution(billType)) {
      return {
        headline: `Introduced in the ${origin}`,
        detail: `This ${typeInfo.label.toLowerCase()} has been filed and is awaiting consideration. It only needs to pass the ${origin} to take effect.`,
      };
    }
    if (isConcurrentResolution(billType)) {
      return {
        headline: `Introduced in the ${origin}`,
        detail: `This ${typeInfo.label.toLowerCase()} has been filed. It will need to pass both the ${origin} and the ${other}.`,
      };
    }
    return {
      headline: `Introduced in the ${origin}`,
      detail: `This ${typeInfo.label.toLowerCase()} has been filed and is working its way through Congress. It will need to pass both the ${origin} and the ${other}, then be signed by the President to become law.`,
    };
  }

  if (currentStatus === "passed_simpleres") {
    return {
      headline: `Passed the ${origin}`,
      detail: `This resolution has been adopted by the ${origin}. As a simple resolution, it did not need the other chamber's approval or the President's signature — so it's complete.`,
    };
  }

  if (currentStatus === "passed_concurrentres") {
    return {
      headline: "Passed both chambers",
      detail: `This concurrent resolution has been adopted by both the ${origin} and the ${other}. It does not require the President's signature.`,
    };
  }

  if (currentStatus === "passed_bill") {
    return {
      headline: "Passed Congress",
      detail: `This ${typeInfo.label.toLowerCase()} has passed both the ${origin} and the ${other}. It is now awaiting the President's signature to become law.`,
    };
  }

  if (currentStatus.startsWith("conference_")) {
    return {
      headline: "Passed after conference",
      detail: `The ${origin} and ${other} passed different versions of this bill, so a conference committee worked out the differences. The final version has now passed both chambers and awaits the President's signature.`,
    };
  }

  if (currentStatus === "enacted_signed") {
    return {
      headline: "Signed into law",
      detail:
        "The President has signed this bill. It is now the law of the land.",
    };
  }

  if (currentStatus === "enacted_tendayrule") {
    return {
      headline: "Became law (unsigned)",
      detail:
        "The President did not sign this bill within 10 days while Congress was in session, so it automatically became law.",
    };
  }

  if (currentStatus === "enacted_veto_override") {
    return {
      headline: "Enacted — veto overridden",
      detail:
        "The President vetoed this bill, but Congress overrode the veto with a two-thirds vote in both chambers. It is now law.",
    };
  }

  // Reported out of committee
  if (currentStatus === "reported") {
    return {
      headline: "Reported by Committee",
      detail: `A committee in the ${origin} has reviewed this ${typeInfo.label.toLowerCase()} and reported it to the full chamber for consideration.`,
    };
  }

  // Passed one chamber
  if (currentStatus === "pass_over_house") {
    return {
      headline: "Passed the House",
      detail: `This ${typeInfo.label.toLowerCase()} has been approved by the House of Representatives and is now before the Senate.`,
    };
  }
  if (currentStatus === "pass_over_senate") {
    return {
      headline: "Passed the Senate",
      detail: `This ${typeInfo.label.toLowerCase()} has been approved by the Senate and is now before the House of Representatives.`,
    };
  }

  // Ping-pong (pass back with amendments)
  if (currentStatus === "pass_back_house") {
    return {
      headline: "Passed House (with changes)",
      detail: `The House passed an amended version of this ${typeInfo.label.toLowerCase()}. The Senate must now decide whether to accept the changes or request further negotiation.`,
    };
  }
  if (currentStatus === "pass_back_senate") {
    return {
      headline: "Passed Senate (with changes)",
      detail: `The Senate passed an amended version of this ${typeInfo.label.toLowerCase()}. The House must now decide whether to accept the changes or request further negotiation.`,
    };
  }

  // Provisional kills (bill is stalled but could be revived)
  if (currentStatus === "prov_kill_cloturefailed") {
    return {
      headline: "Blocked by Filibuster",
      detail:
        "A cloture vote failed in the Senate, meaning debate could not be ended to move to a final vote. The bill is effectively stalled but could be brought up again.",
    };
  }
  if (currentStatus === "prov_kill_suspensionfailed") {
    return {
      headline: "Suspension of Rules Failed",
      detail:
        "The House attempted to fast-track this bill under suspension of the rules, but the motion failed to get the required two-thirds majority. The bill could still be brought up under normal procedures.",
    };
  }
  if (currentStatus === "prov_kill_pingpongfail") {
    return {
      headline: "Reconciliation Failed",
      detail:
        "The two chambers could not agree on a final version of this bill during the amendment exchange process.",
    };
  }
  if (currentStatus === "prov_kill_veto") {
    return {
      headline: "Vetoed by the President",
      detail:
        "The President has vetoed this bill. Congress can attempt to override the veto with a two-thirds vote in both chambers.",
    };
  }

  // Hard failures
  if (currentStatus === "fail_originating_house") {
    return {
      headline: "Failed in the House",
      detail: "This bill was voted down in the House of Representatives.",
    };
  }
  if (currentStatus === "fail_originating_senate") {
    return {
      headline: "Failed in the Senate",
      detail: "This bill was voted down in the Senate.",
    };
  }
  if (currentStatus === "fail_second_house") {
    return {
      headline: "Failed in the House",
      detail: `This ${typeInfo.label.toLowerCase()} passed the Senate but was voted down in the House of Representatives.`,
    };
  }
  if (currentStatus === "fail_second_senate") {
    return {
      headline: "Failed in the Senate",
      detail: `This ${typeInfo.label.toLowerCase()} passed the House but was voted down in the Senate.`,
    };
  }

  // Veto-related
  if (currentStatus === "vetoed_pocket") {
    return {
      headline: "Pocket Vetoed",
      detail:
        "The President did not sign this bill and Congress adjourned within 10 days, resulting in a pocket veto. A pocket veto cannot be overridden.",
    };
  }
  if (currentStatus.startsWith("vetoed_override_fail_")) {
    return {
      headline: "Veto Override Failed",
      detail:
        "The President vetoed this bill, and Congress attempted to override the veto but failed to achieve the required two-thirds majority.",
    };
  }

  // Fallback
  return {
    headline: currentStatus
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    detail: `This ${typeInfo.label.toLowerCase()} is currently in the legislative process.`,
  };
}

// ─── Dynamic Journey from Real Actions ──────────────────────────────

interface ActionRecord {
  actionDate: Date;
  chamber: string | null;
  text: string;
  actionType: string | null;
}

interface VersionRecord {
  versionCode: string;
  versionType: string;
  versionDate: Date;
  changeSummary: string | null;
  isSubstantive: boolean;
}

interface Milestone {
  label: string;
  description: string;
  date: Date;
  detail?: string;
  /** Used to match version changeSummaries to action milestones */
  milestoneType?: "introduced" | "committee" | "passage" | "signed" | "vetoed";
  chamber?: string;
}

/**
 * Map version codes to the action milestone they correspond to.
 * RS = committee report in Senate, ES = Senate passage, EAH = House amendment, etc.
 */
const VERSION_TO_MILESTONE: Record<
  string,
  { type: Milestone["milestoneType"]; chamber: string }
> = {
  // Committee reports
  rh: { type: "committee", chamber: "House" },
  rs: { type: "committee", chamber: "Senate" },
  // Chamber passage (engrossed = passed with floor amendments)
  eh: { type: "passage", chamber: "House" },
  es: { type: "passage", chamber: "Senate" },
  cph: { type: "passage", chamber: "House" },
  cps: { type: "passage", chamber: "Senate" },
  // Cross-chamber amendments (EAH = House amended a Senate bill, etc.)
  eah: { type: "passage", chamber: "House" },
  eas: { type: "passage", chamber: "Senate" },
  // Enrolled = final text, attach to signing or last passage
  enr: { type: "signed", chamber: "Congress" },
};

/**
 * Extract key milestones from raw BillAction records.
 */
function extractActionMilestones(actions: ActionRecord[]): Milestone[] {
  const milestones: Milestone[] = [];
  const sorted = [...actions].sort(
    (a, b) => a.actionDate.getTime() - b.actionDate.getTime(),
  );

  // Track which chambers have had a passage milestone recorded
  const passedChambers = new Set<string>();
  let hasIntro = false;
  let hasSigned = false;

  for (const action of sorted) {
    const text = action.text;
    const type = action.actionType;
    const chamber = action.chamber;

    // Introduction — first IntroReferral action (text may not say "introduced")
    if (type === "IntroReferral" && !hasIntro && chamber) {
      hasIntro = true;
      milestones.push({
        label: `Introduced in ${chamber}`,
        description: `Filed in the ${chamber}`,
        date: action.actionDate,
        milestoneType: "introduced",
        chamber,
      });
      continue;
    }

    // Committee reported
    if (
      type === "Committee" &&
      /reported/i.test(text) &&
      !/referred/i.test(text)
    ) {
      if (!milestones.some((m) => m.milestoneType === "committee")) {
        milestones.push({
          label: "Reported by Committee",
          description:
            "A committee reviewed this bill and advanced it for full consideration",
          date: action.actionDate,
          milestoneType: "committee",
          chamber: chamber || undefined,
        });
      }
      continue;
    }

    // Chamber passage
    if (type === "Floor" && /passed|agreed to/i.test(text) && chamber) {
      if (!passedChambers.has(chamber)) {
        passedChambers.add(chamber);
        milestones.push({
          label: `Passed ${chamber}`,
          description: `Approved by the ${chamber}`,
          date: action.actionDate,
          milestoneType: "passage",
          chamber,
        });
      }
      continue;
    }

    // Became law. Congress.gov emits two separate rows for enactment —
    // "Became Public Law No: …" and "Signed by President." — both match
    // the regex, so dedup on the first one. "BecameLaw" is the GovTrack
    // action type; Congress.gov uses "President" plus the text we match
    // below (and also uses "President" for vetoes, so we don't match on
    // type alone).
    if (
      !hasSigned &&
      (type === "BecameLaw" ||
        /became public law|signed by president/i.test(text))
    ) {
      hasSigned = true;
      milestones.push({
        label: "Signed into Law",
        description: "Signed by the President",
        date: action.actionDate,
        milestoneType: "signed",
      });
      continue;
    }

    // Vetoed
    if (type === "Veto" || /vetoed/i.test(text)) {
      milestones.push({
        label: "Vetoed",
        description: "Vetoed by the President",
        date: action.actionDate,
        milestoneType: "vetoed",
      });
      continue;
    }
  }

  return milestones;
}

/**
 * Attach version changeSummaries to their corresponding action milestones.
 * Version texts are produced BY legislative actions (committee markup → RS,
 * floor passage → ES, cross-chamber amendment → EAH), so they should
 * enrich the action milestone rather than appear as separate steps.
 *
 * If a version has no matching action milestone (orphaned), it becomes
 * a standalone milestone.
 */
function attachVersionDetails(
  milestones: Milestone[],
  versions: VersionRecord[],
): Milestone[] {
  const result = [...milestones];

  for (const v of versions) {
    const code = v.versionCode.toLowerCase();
    // Skip intro versions and procedural versions
    if (code === "ih" || code === "is") continue;
    if (!v.isSubstantive || !v.changeSummary) continue;
    if (v.changeSummary === "Initial version of the bill as introduced.")
      continue;

    const mapping = VERSION_TO_MILESTONE[code];
    if (!mapping) continue;

    // Find the matching action milestone
    const match = result.find((m) => {
      if (!m.milestoneType) return false;
      // For passage milestones, match by type AND chamber
      if (mapping.type === "passage") {
        return m.milestoneType === "passage" && m.chamber === mapping.chamber;
      }
      // For committee, match by type (chamber doesn't always align perfectly)
      if (mapping.type === "committee") {
        return m.milestoneType === "committee";
      }
      // For signed/enrolled, match by type
      return m.milestoneType === mapping.type;
    });

    if (match) {
      // Fold the changeSummary into the existing milestone
      match.detail = v.changeSummary;
      // If there were cross-chamber amendments, note it in the label
      if (
        (code === "eah" || code === "eas") &&
        !match.label.includes("with changes")
      ) {
        match.label = `${match.label} (with changes)`;
        match.description = `The ${mapping.chamber} passed an amended version`;
      }
    } else {
      // Orphaned version — no matching action. Show as standalone.
      const chamber = mapping.chamber;
      result.push({
        label: `Amended in ${chamber}`,
        description: v.versionType,
        date: v.versionDate,
        detail: v.changeSummary,
      });
    }
  }

  // Re-sort after potential insertions
  result.sort((a, b) => a.date.getTime() - b.date.getTime());
  return result;
}

/**
 * Given the bill's currentStatus and type, return the "current" and
 * "upcoming" steps that haven't happened yet.
 */
function getFutureSteps(
  billType: string,
  currentStatus: string,
  completedLabels: Set<string>,
): JourneyStep[] {
  const origin = getOriginChamber(billType);
  const other = getOtherChamber(billType);
  const isEnacted = currentStatus.startsWith("enacted_");
  const isFailed =
    currentStatus.startsWith("fail_") ||
    currentStatus.startsWith("prov_kill_") ||
    currentStatus.startsWith("vetoed_");

  // Enacted or failed — no future steps
  if (isEnacted || isFailed) return [];

  const steps: JourneyStep[] = [];

  // Determine what the "current" step is based on status
  let currentLabel: string | null = null;
  let currentDescription = "";

  if (currentStatus === "introduced" || currentStatus === "reported") {
    if (!completedLabels.has(`Passed ${origin}`)) {
      currentLabel = `${origin} vote`;
      currentDescription = `Awaiting a vote in the ${origin}`;
    } else if (!completedLabels.has(`Passed ${other}`)) {
      currentLabel = `${other} consideration`;
      currentDescription = `Being considered by the ${other}`;
    }
  } else if (currentStatus === "pass_over_house") {
    if (!completedLabels.has("Passed Senate")) {
      currentLabel = "Senate consideration";
      currentDescription = "Being considered by the Senate";
    }
  } else if (currentStatus === "pass_over_senate") {
    if (!completedLabels.has("Passed House")) {
      currentLabel = "House consideration";
      currentDescription = "Being considered by the House";
    }
  } else if (currentStatus === "pass_back_house") {
    currentLabel = "Senate vote on changes";
    currentDescription = "The Senate must vote on the House's amended version";
  } else if (currentStatus === "pass_back_senate") {
    currentLabel = "House vote on changes";
    currentDescription = "The House must vote on the Senate's amended version";
  } else if (
    currentStatus === "passed_bill" ||
    currentStatus.startsWith("conference_")
  ) {
    currentLabel = "Presidential signature";
    currentDescription = "Awaiting the President's signature";
  }

  if (currentLabel) {
    steps.push({
      label: currentLabel,
      description: currentDescription,
      status: "current",
    });
  }

  // Terminal step
  if (isSimpleResolution(billType)) {
    if (!completedLabels.has(`Passed ${origin}`)) {
      steps.push({
        label: `Passed ${origin}`,
        description: `Adopted by the ${origin}`,
        status: "upcoming",
      });
    }
  } else if (isConcurrentResolution(billType)) {
    // No "Became Law" for concurrent resolutions
  } else {
    // Bills and joint resolutions
    if (!completedLabels.has("Signed into Law")) {
      steps.push({
        label: "Become Law",
        description: "Signed by the President",
        status: "upcoming",
      });
    }
  }

  return steps;
}

/**
 * Build a dynamic legislative journey from real bill actions and text versions.
 *
 * Version changeSummaries are folded into their corresponding action milestones
 * (e.g., the EAH version summary enriches the "Passed House" milestone rather
 * than appearing as a separate "Major changes" step).
 *
 * Falls back to the static getJourneySteps() if no actions are available.
 */
/**
 * Derive the effective status from real actions + versions.
 *
 * The DB `currentStatus` can be wrong (e.g. `passed_bill` when the House
 * passed with amendments and the Senate hasn't voted on those changes yet).
 * This function detects that case by looking at whether the last milestone
 * is a cross-chamber amendment ("with changes") and corrects the status.
 *
 * Returns the original status when no correction is needed, or when there
 * are no actions to analyze.
 */
export function getEffectiveStatus(
  billType: string,
  currentStatus: string,
  actions: ActionRecord[],
  textVersions: VersionRecord[],
): string {
  if (actions.length === 0) return currentStatus;

  const isFailed =
    currentStatus.startsWith("fail_") ||
    currentStatus.startsWith("prov_kill_") ||
    currentStatus.startsWith("vetoed_");
  if (isFailed || currentStatus.startsWith("enacted_")) return currentStatus;

  const actionMilestones = extractActionMilestones(actions);
  const enrichedMilestones = attachVersionDetails(
    actionMilestones,
    textVersions,
  );
  const lastMilestone = enrichedMilestones[enrichedMilestones.length - 1];

  // Self-heal when the DB's currentStatus lags behind ingested actions —
  // if any action shows the bill was signed, treat it as enacted so the
  // badge doesn't say "awaiting the President's signature" while the
  // timeline already shows "Signed into Law".
  if (enrichedMilestones.some((m) => m.milestoneType === "signed")) {
    return "enacted_signed";
  }

  if (lastMilestone?.label.includes("(with changes)")) {
    if (lastMilestone.chamber === "House") return "pass_back_house";
    if (lastMilestone.chamber === "Senate") return "pass_back_senate";
  }

  return currentStatus;
}

export function buildDynamicJourney(
  billType: string,
  currentStatus: string,
  actions: ActionRecord[],
  textVersions: VersionRecord[],
  effectiveStatus?: string,
): JourneyStep[] {
  const status =
    effectiveStatus ??
    getEffectiveStatus(billType, currentStatus, actions, textVersions);
  const staticJourney = getJourneySteps(billType, status);

  if (actions.length === 0) {
    return staticJourney;
  }

  // Extract milestones from actions, then attach version details
  const actionMilestones = extractActionMilestones(actions);
  const enrichedMilestones = attachVersionDetails(
    actionMilestones,
    textVersions,
  );

  // Convert to JourneySteps (all completed — they happened)
  const isFailed =
    status.startsWith("fail_") ||
    status.startsWith("prov_kill_") ||
    status.startsWith("vetoed_");

  const completedSteps: JourneyStep[] = enrichedMilestones.map((m, i) => {
    const isLastAndFailed = isFailed && i === enrichedMilestones.length - 1;
    return {
      label: m.label,
      description: m.description,
      status: isLastAndFailed ? "failed" : "completed",
      date: m.date.toISOString(),
      detail: m.detail,
    };
  });

  // Build set of completed labels for future step logic
  const completedLabels = new Set(enrichedMilestones.map((m) => m.label));

  // Add current + upcoming steps
  const futureSteps = isFailed
    ? []
    : getFutureSteps(billType, status, completedLabels);

  const dynamicJourney = [...completedSteps, ...futureSteps];

  // If actions are incomplete (e.g. only intro was synced but the bill is
  // enacted), the dynamic journey will have fewer steps than the bill's
  // core milestones and look broken. Fall back to the static journey in
  // that case. The threshold is the pre-six-stop milestone count (intro,
  // pass origin, pass other, law) — NOT staticJourney.length, because a
  // legitimate dynamic journey may skip the committee stop (e.g. a bill
  // brought straight to the floor) and must not be discarded for it.
  const minExpectedSteps = isSimpleResolution(billType)
    ? 2
    : isConcurrentResolution(billType)
      ? 3
      : 4;
  if (
    dynamicJourney.length < Math.min(minExpectedSteps, staticJourney.length)
  ) {
    return staticJourney;
  }

  return dynamicJourney;
}
