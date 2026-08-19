import { notFound } from "next/navigation";

import { CustomObjectIdStringSchema } from "@/shared/schemas";

import type { NextPageProps } from "@/shared/types/types";

/**
 * Parse, not cast: nothing checks what an id segment holds, and an arbitrary one becomes a
 * backend request plus a `use cache` entry per variant. No fallback record exists for these
 * routes, so a bad value ends the render in not-found.
 */
export async function resolveObjectIdParam<TKey extends string>(
  paramsPromise: NextPageProps<Record<TKey, string>>["params"],
  key: TKey,
): Promise<string> {
  const parsed = CustomObjectIdStringSchema.safeParse((await paramsPromise)[key]);
  if (!parsed.success) notFound();

  return parsed.data;
}
