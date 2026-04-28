import { z } from "zod";

// Per-account preferences stored as JSONB on Profile.preferences. Add new keys
// here — schema validates on read and write so we never trust raw DB JSON or
// raw client input. Defaults applied when a user has no value for a key yet
// (new accounts, or keys added after the row was created).
export const userPreferencesSchema = z
  .object({
    hideVoted: z.boolean().default(false),
  })
  .strict();

export type UserPreferences = z.infer<typeof userPreferencesSchema>;
export type UserPreferenceKey = keyof UserPreferences;

export const DEFAULT_USER_PREFERENCES: UserPreferences =
  userPreferencesSchema.parse({});

// Coerces an unknown value (raw DB JSON, partial client payload) into a
// fully-defaulted UserPreferences. Strips unknown keys; on parse failure
// falls back to defaults rather than throwing — a corrupt prefs blob should
// not 500 a feed render.
export function coerceUserPreferences(value: unknown): UserPreferences {
  const result = userPreferencesSchema.safeParse(value ?? {});
  return result.success ? result.data : DEFAULT_USER_PREFERENCES;
}

// Partial schema for PATCH bodies — every key optional. Defined separately
// (rather than via .partial()) because .partial() preserves .default() on the
// inner fields, which would force-write the default for any omitted key.
export const userPreferencesPatchSchema = z
  .object({
    hideVoted: z.boolean().optional(),
  })
  .strict();
export type UserPreferencesPatch = z.infer<typeof userPreferencesPatchSchema>;
