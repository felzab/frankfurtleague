/** The four keys the backend answers on, spelled as `fl_frontend/src/core/api.ts :: FetchOptions` spells them. */
export const KEY_TIERS = ["base", "admin", "system", "none"] as const;

export type KeyTier = (typeof KEY_TIERS)[number];

/** The OpenAPI extension `fl_backend/app/main.py :: publish_key_tiers` writes on every operation. */
export const KEY_TIER_EXTENSION = "x-fl-tier";

// What a call site sends by declaring no `authType` at all, which is the tier most of them are
// compared under (`fl_frontend/src/core/api.ts :: BASE_FETCH_AUTH_TYPE`).
export const DECLARED_BY_DEFAULT: KeyTier = "base";

/**
 * `null` where the operation names no tier this can spell, so a caller reports it rather than
 * reading the absence as a match: a reader that quietly found nothing would pass every comparison.
 */
export function keyTierOf(operation: Record<string, unknown>): KeyTier | null {
  const published = operation[KEY_TIER_EXTENSION];

  return KEY_TIERS.find((tier) => tier === published) ?? null;
}
