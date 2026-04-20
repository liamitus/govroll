import { describe, it, expect } from "vitest";
import {
  parseBillCitation,
  formatBillCitation,
} from "@/lib/parse-bill-citation";

describe("parseBillCitation", () => {
  describe("House Bill (HR)", () => {
    it("parses canonical form", () => {
      expect(parseBillCitation("HR 1234")).toEqual({
        billType: "house_bill",
        shortLabel: "H.R.",
        shortCode: "hr",
        number: 1234,
        congress: null,
      });
    });

    it.each([
      "hr 1234",
      "HR1234",
      "hr1234",
      "H.R. 1234",
      "H.R.1234",
      "H. R. 1234",
      "H R 1234",
      "h.r 1234",
      "h-r 1234",
    ])("accepts variant %s", (input) => {
      expect(parseBillCitation(input)?.number).toBe(1234);
      expect(parseBillCitation(input)?.billType).toBe("house_bill");
    });
  });

  describe("Senate Bill (S)", () => {
    it.each(["S 200", "s 200", "S.200", "S. 200", "s200"])(
      "parses %s",
      (input) => {
        expect(parseBillCitation(input)).toMatchObject({
          billType: "senate_bill",
          shortCode: "s",
          number: 200,
        });
      },
    );
  });

  describe("Joint Resolutions", () => {
    it.each([
      ["HJRes 5", "house_joint_resolution", 5],
      ["H.J.Res. 5", "house_joint_resolution", 5],
      ["H. J. Res. 5", "house_joint_resolution", 5],
      ["hjres5", "house_joint_resolution", 5],
      ["SJRes 10", "senate_joint_resolution", 10],
      ["S.J.Res. 10", "senate_joint_resolution", 10],
      ["sjres 10", "senate_joint_resolution", 10],
    ])("parses %s → %s %d", (input, billType, number) => {
      expect(parseBillCitation(input)).toMatchObject({ billType, number });
    });
  });

  describe("Concurrent Resolutions", () => {
    it.each([
      ["HConRes 1", "house_concurrent_resolution"],
      ["H.Con.Res. 1", "house_concurrent_resolution"],
      ["hconres 1", "house_concurrent_resolution"],
      ["SConRes 1", "senate_concurrent_resolution"],
      ["S.Con.Res. 1", "senate_concurrent_resolution"],
    ])("parses %s", (input, billType) => {
      expect(parseBillCitation(input)).toMatchObject({ billType, number: 1 });
    });
  });

  describe("Simple Resolutions", () => {
    it.each([
      ["HRes 100", "house_resolution", 100],
      ["H.Res. 100", "house_resolution", 100],
      ["hres 100", "house_resolution", 100],
      ["SRes 50", "senate_resolution", 50],
      ["S.Res. 50", "senate_resolution", 50],
    ])("parses %s", (input, billType, number) => {
      expect(parseBillCitation(input)).toMatchObject({ billType, number });
    });
  });

  describe("Congress number", () => {
    it("accepts leading Congress", () => {
      expect(parseBillCitation("119 HR 1")).toMatchObject({
        billType: "house_bill",
        number: 1,
        congress: 119,
      });
    });

    it("accepts leading Congress with ordinal suffix", () => {
      expect(parseBillCitation("119th HR 1")).toMatchObject({
        congress: 119,
      });
    });

    it("accepts trailing Congress", () => {
      expect(parseBillCitation("HR 1 119")).toMatchObject({ congress: 119 });
    });

    it("accepts trailing Congress in parens", () => {
      expect(parseBillCitation("HR 1 (119)")).toMatchObject({
        congress: 119,
      });
    });

    it("accepts trailing Congress with ordinal suffix", () => {
      expect(parseBillCitation("HR 1 119th")).toMatchObject({ congress: 119 });
    });

    it("returns congress=null when not specified", () => {
      expect(parseBillCitation("HR 1234")?.congress).toBeNull();
    });
  });

  describe("non-matches", () => {
    it.each([
      "",
      "   ",
      "just a title",
      "CHIPS Act",
      "HR",
      "HR abc",
      "1234",
      "HR 0",
      "ZR 5",
    ])("returns null for %s", (input) => {
      expect(parseBillCitation(input)).toBeNull();
    });
  });

  describe("disambiguation", () => {
    it("does not mistake HRes for HR", () => {
      expect(parseBillCitation("HRes 100")).toMatchObject({
        billType: "house_resolution",
        number: 100,
      });
    });

    it("does not mistake HJRes for HR", () => {
      expect(parseBillCitation("HJRes 5")).toMatchObject({
        billType: "house_joint_resolution",
        number: 5,
      });
    });

    it("does not mistake SJRes for S", () => {
      expect(parseBillCitation("SJRes 10")).toMatchObject({
        billType: "senate_joint_resolution",
        number: 10,
      });
    });
  });
});

describe("formatBillCitation", () => {
  it("formats without Congress", () => {
    const c = parseBillCitation("HR 1234")!;
    expect(formatBillCitation(c)).toBe("H.R. 1234");
  });

  it("formats with Congress as ordinal", () => {
    const c = parseBillCitation("HR 1234 119")!;
    expect(formatBillCitation(c)).toBe("H.R. 1234 · 119th Congress");
  });

  it("uses correct ordinal for 1st/2nd/3rd", () => {
    const c1 = parseBillCitation("HR 1 1")!;
    expect(formatBillCitation(c1)).toBe("H.R. 1 · 1st Congress");
    const c2 = parseBillCitation("HR 1 2")!;
    expect(formatBillCitation(c2)).toBe("H.R. 1 · 2nd Congress");
    const c3 = parseBillCitation("HR 1 3")!;
    expect(formatBillCitation(c3)).toBe("H.R. 1 · 3rd Congress");
  });

  it("uses 11th/12th/13th exceptions correctly", () => {
    const c11 = parseBillCitation("HR 1 11")!;
    expect(formatBillCitation(c11)).toBe("H.R. 1 · 11th Congress");
    const c112 = parseBillCitation("HR 1 112")!;
    expect(formatBillCitation(c112)).toBe("H.R. 1 · 112th Congress");
  });

  it("formats S.J.Res. correctly", () => {
    const c = parseBillCitation("sjres 10")!;
    expect(formatBillCitation(c)).toBe("S.J.Res. 10");
  });
});
