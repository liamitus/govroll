import { describe, it, expect } from "vitest";
import { groupBills, formatBillNumber } from "@/lib/bill-grouping";
import type { BillSummary } from "@/types";

// Minimal factory — only the fields groupBills looks at are required to
// vary across tests. Everything else gets a neutral default.
function bill(overrides: Partial<BillSummary> & { id: number }): BillSummary {
  return {
    billId: `senate_joint_resolution-${overrides.id}-119`,
    title: "Default title",
    date: "2026-03-18T00:00:00.000Z",
    billType: "senate_joint_resolution",
    currentChamber: null,
    currentStatus: "introduced",
    currentStatusDate: "2026-03-18T00:00:00.000Z",
    introducedDate: "2026-03-18T00:00:00.000Z",
    link: "",
    shortText: null,
    sponsor: null,
    policyArea: null,
    latestActionText: null,
    latestActionDate: null,
    momentumTier: null,
    momentumScore: null,
    daysSinceLastAction: null,
    deathReason: null,
    popularTitle: null,
    shortTitle: null,
    displayTitle: null,
    ...overrides,
  };
}

describe("groupBills", () => {
  it("returns empty array for empty input", () => {
    expect(groupBills([])).toEqual([]);
  });

  it("passes a singleton through as kind=single", () => {
    const b = bill({ id: 1 });
    const out = groupBills([b]);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ kind: "single", bill: b });
  });

  it("groups two bills with identical billType + day + title", () => {
    const a = bill({ id: 1, title: "Same title" });
    const b = bill({ id: 2, title: "Same title" });
    const out = groupBills([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("group");
    if (out[0].kind === "group") {
      expect(out[0].bills).toEqual([a, b]);
    }
  });

  it("groups three matching bills into one cluster", () => {
    const bills = [1, 2, 3].map((id) => bill({ id, title: "Same" }));
    const out = groupBills(bills);
    expect(out).toHaveLength(1);
    if (out[0].kind === "group") {
      expect(out[0].bills.map((b) => b.id)).toEqual([1, 2, 3]);
    }
  });

  it("does not group bills with different billType (cross-chamber companions)", () => {
    // Companion bills — same title + date, different chambers. Must stay
    // separate because we don't yet handle cross-chamber merging.
    const senate = bill({ id: 1, title: "Companion", billType: "senate_bill" });
    const house = bill({ id: 2, title: "Companion", billType: "house_bill" });
    const out = groupBills([senate, house]);
    expect(out).toHaveLength(2);
    expect(out.every((x) => x.kind === "single")).toBe(true);
  });

  it("does not group bills introduced on different days", () => {
    const a = bill({
      id: 1,
      title: "Same",
      introducedDate: "2026-03-18T00:00:00.000Z",
    });
    const b = bill({
      id: 2,
      title: "Same",
      introducedDate: "2026-03-19T00:00:00.000Z",
    });
    const out = groupBills([a, b]);
    expect(out).toHaveLength(2);
    expect(out.every((x) => x.kind === "single")).toBe(true);
  });

  it("does not group bills with different titles", () => {
    const a = bill({ id: 1, title: "Disapproval of foreign military sale" });
    const b = bill({ id: 2, title: "Disapproval of licensing" });
    const out = groupBills([a, b]);
    expect(out).toHaveLength(2);
  });

  it("normalizes whitespace and case when comparing titles", () => {
    const a = bill({ id: 1, title: "  FOREIGN  military   sale.  " });
    const b = bill({ id: 2, title: "foreign military sale." });
    const out = groupBills([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("group");
  });

  it("keeps a group anchored at the first member's feed position", () => {
    // Feed order: A (singleton), B (group lead), C (singleton), D (joins group with B)
    // Expected output: A, group(B, D), C — group sits where B was.
    const a = bill({ id: 1, title: "Alpha" });
    const b = bill({ id: 2, title: "Shared" });
    const c = bill({ id: 3, title: "Gamma" });
    const d = bill({ id: 4, title: "Shared" });
    const out = groupBills([a, b, c, d]);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({ kind: "single", bill: a });
    expect(out[1].kind).toBe("group");
    if (out[1].kind === "group") {
      expect(out[1].bills.map((x) => x.id)).toEqual([2, 4]);
    }
    expect(out[2]).toEqual({ kind: "single", bill: c });
  });

  it("passes bills with missing introducedDate through as singletons", () => {
    const a = bill({ id: 1, title: "Same", introducedDate: "" });
    const b = bill({ id: 2, title: "Same", introducedDate: "" });
    const out = groupBills([a, b]);
    // Both have empty introducedDate which fails the groupKey guard — never group.
    expect(out).toHaveLength(2);
    expect(out.every((x) => x.kind === "single")).toBe(true);
  });

  it("ignores sponsor — groups regardless of whether sponsor is present", () => {
    // Dev data sometimes has null sponsor; prod has it populated. Grouping
    // must not depend on this field.
    const a = bill({ id: 1, title: "Same", sponsor: null });
    const b = bill({ id: 2, title: "Same", sponsor: "Sen. X" });
    const out = groupBills([a, b]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("group");
  });
});

describe("formatBillNumber", () => {
  it("formats a senate joint resolution", () => {
    expect(
      formatBillNumber(
        "senate_joint_resolution",
        "senate_joint_resolution-137-119",
      ),
    ).toBe("S.J.Res. 137");
  });

  it("formats a house bill", () => {
    expect(formatBillNumber("house_bill", "house_bill-1234-119")).toBe(
      "H.R. 1234",
    );
  });

  it("formats a senate concurrent resolution", () => {
    expect(
      formatBillNumber(
        "senate_concurrent_resolution",
        "senate_concurrent_resolution-12-119",
      ),
    ).toBe("S.Con.Res. 12");
  });

  it("falls back to the raw billId when parts are missing", () => {
    expect(formatBillNumber("senate_bill", "malformed")).toBe("malformed");
  });
});
