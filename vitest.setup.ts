import "@testing-library/jest-dom/vitest";

// congress-api.ts logs + fires a one-time alert at module load when this key is
// missing (see item: "fail loudly on missing CONGRESS_DOT_GOV_API_KEY"). Set a
// dummy value here so unit tests — which intercept all HTTP via MSW regardless
// of key value — don't emit that warning or risk an import-time alert fetch.
process.env.CONGRESS_DOT_GOV_API_KEY =
  process.env.CONGRESS_DOT_GOV_API_KEY ?? "test-congress-key";
