import { notFound } from "next/navigation";

import { CustomObjectIdStringSchema } from "@/shared/schemas";

import type { NextPageProps } from "@/shared/types/types";

/**
 * Parse, never cast: the segment reaches the backend under the base API key, so an arbitrary value
 * would become a request plus its own `use cache` entry.
 */
export async function resolveSpielId(paramsPromise: NextPageProps<{ spiel_id: string }>["params"]): Promise<string> {
  const parsed = CustomObjectIdStringSchema.safeParse((await paramsPromise).spiel_id);
  if (!parsed.success) notFound();

  return parsed.data;
}
