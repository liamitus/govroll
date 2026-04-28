import { describe, expect, it } from "vitest";
import {
  DEFAULT_USER_PREFERENCES,
  coerceUserPreferences,
  userPreferencesPatchSchema,
  userPreferencesSchema,
} from "./user-preferences";

describe("userPreferencesSchema", () => {
  it("defaults missing keys to documented defaults", () => {
    expect(userPreferencesSchema.parse({})).toEqual({ hideVoted: false });
  });

  it("accepts a fully-populated valid object", () => {
    expect(userPreferencesSchema.parse({ hideVoted: true })).toEqual({
      hideVoted: true,
    });
  });

  it("rejects unknown keys (strict)", () => {
    expect(() =>
      userPreferencesSchema.parse({ hideVoted: false, sneaky: 1 }),
    ).toThrow();
  });

  it("rejects wrong types", () => {
    expect(() => userPreferencesSchema.parse({ hideVoted: "true" })).toThrow();
  });
});

describe("coerceUserPreferences", () => {
  it("falls back to defaults on null/undefined", () => {
    expect(coerceUserPreferences(null)).toEqual(DEFAULT_USER_PREFERENCES);
    expect(coerceUserPreferences(undefined)).toEqual(DEFAULT_USER_PREFERENCES);
  });

  it("falls back to defaults on a corrupt blob (does not throw)", () => {
    expect(coerceUserPreferences("not an object")).toEqual(
      DEFAULT_USER_PREFERENCES,
    );
    expect(coerceUserPreferences({ hideVoted: 42 })).toEqual(
      DEFAULT_USER_PREFERENCES,
    );
  });

  it("returns parsed object for valid input", () => {
    expect(coerceUserPreferences({ hideVoted: true })).toEqual({
      hideVoted: true,
    });
  });
});

describe("userPreferencesPatchSchema", () => {
  it("accepts an empty patch", () => {
    expect(userPreferencesPatchSchema.parse({})).toEqual({});
  });

  it("accepts a partial patch", () => {
    expect(userPreferencesPatchSchema.parse({ hideVoted: true })).toEqual({
      hideVoted: true,
    });
  });

  it("rejects unknown keys (strict)", () => {
    expect(() =>
      userPreferencesPatchSchema.parse({ unknownKey: "x" }),
    ).toThrow();
  });
});
