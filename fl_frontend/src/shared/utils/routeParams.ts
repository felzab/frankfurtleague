import { notFound } from "next/navigation";

import { CustomObjectIdStringSchema } from "@/shared/schemas";

import type { NextPageProps } from "@/shared/types/types";

/**
 * Parse, not cast: nothing checks what an id segment holds, and an arbitrary one becomes a
 * backend request plus a `use cache` entry per variant. `null` for a malformed one, which no record holds, so a
 * page's metadata answers it as the not-found it is (`fl_frontend/src/shared/utils/notFoundMetadata.ts :: metadataFor`).
 */
export async function objectIdParamOf<TKey extends string>(
  paramsPromise: NextPageProps<Record<TKey, string>>["params"],
  key: TKey,
): Promise<string | null> {
  const parsed = CustomObjectIdStringSchema.safeParse((await paramsPromise)[key]);
  return parsed.success ? parsed.data : null;
}

/** An id segment, or not-found: no fallback record exists for these routes, so a bad value ends the render there. */
export async function resolveObjectIdParam<TKey extends string>(
  paramsPromise: NextPageProps<Record<TKey, string>>["params"],
  key: TKey,
): Promise<string> {
  const id = await objectIdParamOf(paramsPromise, key);
  if (id === null) notFound();

  return id;
}
