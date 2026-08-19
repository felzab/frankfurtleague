import { notFound } from "next/navigation";

import { CustomObjectIdStringSchema } from "@/shared/schemas";

import type { NextPageProps } from "@/shared/types/types";

/**
 * Parses a `[spieler_id]` route segment, or renders not-found.
 *
 * Parse, not cast — `resolveTeamId` carries the reasoning. A bad id ends the render: unlike a
 * season, there is no sensible fallback player.
 */
export async function resolveSpielerId(paramsPromise: NextPageProps<{ spieler_id: string }>["params"]): Promise<string> {
  const parsed = CustomObjectIdStringSchema.safeParse((await paramsPromise).spieler_id);
  if (!parsed.success) notFound();

  return parsed.data;
}
