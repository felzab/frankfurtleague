import { notFound } from "next/navigation";

import { CustomObjectIdStringSchema } from "@/shared/schemas";

import type { NextPageProps } from "@/shared/types/types";

/**
 * Parses a `[team_id]` route segment, or renders not-found.
 *
 * Parse, not cast. `NextPageProps<{ team_id: string }>` already makes the value a `string` at the
 * type level, but nothing checks what is actually in the URL, and the value is forwarded to the
 * backend under the base API key. An arbitrarily long segment would otherwise become a backend
 * request plus a distinct `use cache` entry per variant (R3b §S8.2).
 *
 * Unlike `resolveSaisonId`, a bad value cannot degrade to a default — there is no sensible fallback
 * team — so this ends the render instead.
 */
export async function resolveTeamId(paramsPromise: NextPageProps<{ team_id: string }>["params"]): Promise<string> {
  const parsed = CustomObjectIdStringSchema.safeParse((await paramsPromise).team_id);
  if (!parsed.success) notFound();

  return parsed.data;
}
