import { describe, it, expect } from "vitest";
import {
  pickBillHeadline,
  extractHeadlineFromSummary,
} from "@/lib/bill-headline";
import type { BillSummary } from "@/types";

type HeadlineInput = Pick<
  BillSummary,
  "title" | "popularTitle" | "shortTitle" | "displayTitle" | "shortText"
>;

function input(overrides: Partial<HeadlineInput>): HeadlineInput {
  return {
    title: "Default title",
    popularTitle: null,
    shortTitle: null,
    displayTitle: null,
    shortText: null,
    ...overrides,
  };
}

describe("extractHeadlineFromSummary", () => {
  it("strips a 'This bill' opener and capitalizes the verb", () => {
    expect(extractHeadlineFromSummary("This bill renames a post office.")).toBe(
      "Renames a post office.",
    );
  });

  it("strips 'This joint resolution' opener", () => {
    expect(
      extractHeadlineFromSummary(
        "This joint resolution nullifies Public Land Order 7917.",
      ),
    ).toBe("Nullifies Public Land Order 7917.");
  });

  it("strips 'This resolution' opener", () => {
    expect(
      extractHeadlineFromSummary(
        "This resolution expresses support for working families.",
      ),
    ).toBe("Expresses support for working families.");
  });

  it("returns only the first sentence", () => {
    const summary =
      "This bill amends section 5. It also adds a new requirement for reporting.";
    expect(extractHeadlineFromSummary(summary)).toBe("Amends section 5.");
  });

  it("truncates with ellipsis at a word boundary when the first sentence is too long", () => {
    const longSummary =
      "This joint resolution nullifies Public Land Order 7917, which withdrew approximately 225,504 acres of National Forest System lands in Cook, Lake, and Saint Louis Counties from various forms of disposition";
    const result = extractHeadlineFromSummary(longSummary)!;
    expect(result.length).toBeLessThanOrEqual(141);
    expect(result.endsWith("…")).toBe(true);
    // Verify we cut at a word boundary by checking the trailing word is a
    // complete word from the source (i.e. we didn't slice through "Counties"
    // and end up with "Coun…").
    const lastWord = result.slice(0, -1).trim().split(/\s+/).pop()!;
    expect(longSummary).toContain(` ${lastWord} `);
  });

  it("returns null for very short input after stripping", () => {
    expect(extractHeadlineFromSummary("This bill x.")).toBeNull();
  });

  it("works without a leading 'This' opener", () => {
    expect(
      extractHeadlineFromSummary(
        "Authorizes appropriations for fiscal year 2026.",
      ),
    ).toBe("Authorizes appropriations for fiscal year 2026.");
  });
});

describe("pickBillHeadline", () => {
  it("uses popularTitle when present", () => {
    const out = pickBillHeadline(
      input({
        popularTitle: "CHIPS Act",
        shortTitle: "Creating Helpful Incentives Act",
        displayTitle: "An Act to do something",
        title: "An Act to provide for semiconductor manufacturing",
        shortText: "This bill provides incentives.",
      }),
    );
    expect(out.headline).toBe("CHIPS Act");
    expect(out.secondary).toBe("This bill provides incentives.");
    expect(out.officialTitle).toBeNull();
  });

  it("falls back to shortTitle when no popularTitle", () => {
    const out = pickBillHeadline(
      input({
        shortTitle: "ALERT Act",
        title: "An Act to require ADS-B compliance, and for other purposes",
        shortText: "This bill addresses aviation safety.",
      }),
    );
    expect(out.headline).toBe("ALERT Act");
    expect(out.secondary).toBe("This bill addresses aviation safety.");
    expect(out.officialTitle).toBeNull();
  });

  it("uses displayTitle when distinct from title and not procedural", () => {
    const out = pickBillHeadline(
      input({
        title: "An Act to do XYZ, and for other purposes",
        displayTitle: "Some Friendly Display Name",
        shortText: "Summary here.",
      }),
    );
    expect(out.headline).toBe("Some Friendly Display Name");
    expect(out.officialTitle).toBeNull();
  });

  it("ignores displayTitle when it equals title", () => {
    const out = pickBillHeadline(
      input({
        title: "Same as display",
        displayTitle: "Same as display",
        shortText: "Summary.",
      }),
    );
    expect(out.headline).toBe("Same as display");
  });

  it("promotes the summary when title starts with 'Providing for'", () => {
    const out = pickBillHeadline(
      input({
        title:
          "Providing for congressional disapproval under chapter 8 of title 5, United States Code, of the rule submitted by the Bureau of Land Management",
        shortText:
          "This joint resolution nullifies Public Land Order 7917, which withdrew approximately 225,504 acres of National Forest System lands.",
      }),
    );
    expect(out.headline).toMatch(/^Nullifies Public Land Order 7917/);
    expect(out.secondary).toBeNull();
    expect(out.officialTitle).toBe(
      "Providing for congressional disapproval under chapter 8 of title 5, United States Code, of the rule submitted by the Bureau of Land Management",
    );
  });

  it("promotes the summary when title is over 100 chars", () => {
    const out = pickBillHeadline(
      input({
        title:
          "To amend the FISA Amendments Act of 2008 to extend the authorities of title VII of the Foreign Intelligence Surveillance Act of 1978 through April 30, 2026, and for other purposes.",
        shortText:
          "This bill extends the authorities of the Foreign Intelligence Surveillance Act through April 30, 2026.",
      }),
    );
    expect(out.headline).toMatch(/^Extends the authorities/);
    expect(out.officialTitle).toContain("FISA Amendments");
  });

  it("promotes the summary when title ends with 'for other purposes'", () => {
    const out = pickBillHeadline(
      input({
        title: "To do XYZ, and for other purposes.",
        shortText: "This bill does XYZ.",
      }),
    );
    expect(out.headline).toBe("Does XYZ.");
    expect(out.officialTitle).toBe("To do XYZ, and for other purposes.");
  });

  it("does not promote summary when title is short and clean", () => {
    const out = pickBillHeadline(
      input({
        title:
          "Expressing support for tax policies that support working families.",
        shortText:
          "This resolution expresses support for tax policies that support working families.",
      }),
    );
    expect(out.headline).toBe(
      "Expressing support for tax policies that support working families.",
    );
    expect(out.officialTitle).toBeNull();
  });

  it("falls back to title when no shortText is available, even if title is procedural", () => {
    const out = pickBillHeadline(
      input({
        title: "Providing for consideration of H.R. 4690",
        shortText: null,
      }),
    );
    expect(out.headline).toBe("Providing for consideration of H.R. 4690");
    expect(out.officialTitle).toBeNull();
  });

  it("named-act variants take priority even over a procedural title", () => {
    const out = pickBillHeadline(
      input({
        popularTitle: "CHIPS Act",
        title:
          "Providing for the establishment of a semiconductor program, and for other purposes.",
        shortText: "This bill establishes a semiconductor manufacturing fund.",
      }),
    );
    expect(out.headline).toBe("CHIPS Act");
    expect(out.officialTitle).toBeNull();
  });
});
