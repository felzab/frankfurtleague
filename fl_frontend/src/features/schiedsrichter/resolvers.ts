import { notFound } from "next/navigation";

import { CustomObjectIdStringSchema } from "@/shared/schemas";

import type { NextPageProps } from "@/shared/types/types";

/**
 * Parses a `[schiedsrichter_id]` route segment, or renders not-found. Parse and never cast: an
 * unvalidated segment is a backend request and a cache entry per variant.
 */
export async function resolveSchiedsrichterId(paramsPromise: NextPageProps<{ schiedsrichter_id: string }>["params"]): Promise<string> {
  const parsed = CustomObjectIdStringSchema.safeParse((await paramsPromise).schiedsrichter_id);
  if (!parsed.success) notFound();

  return parsed.data;
}
