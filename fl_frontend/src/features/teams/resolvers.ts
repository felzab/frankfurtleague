import { notFound } from "next/navigation";

import { CustomObjectIdStringSchema } from "@/shared/schemas";

import type { NextPageProps } from "@/shared/types/types";

/**
 * Parse, not cast: nothing checks what a `[team_id]` segment holds, and an arbitrary one becomes a
 * backend request plus a `use cache` entry per variant. No fallback team exists, so a bad value
 * ends the render in not-found.
 */
export async function resolveTeamId(paramsPromise: NextPageProps<{ team_id: string }>["params"]): Promise<string> {
  const parsed = CustomObjectIdStringSchema.safeParse((await paramsPromise).team_id);
  if (!parsed.success) notFound();

  return parsed.data;
}
