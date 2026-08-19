import { notFound } from "next/navigation";

import { CustomObjectIdStringSchema } from "@/shared/schemas";

import type { NextPageProps } from "@/shared/types/types";

/** Parse, not cast — `resolveTeamId` documents the reasoning in full and it is identical here. */
export async function resolveSpieltagId(paramsPromise: NextPageProps<{ spieltag_id: string }>["params"]): Promise<string> {
  const parsed = CustomObjectIdStringSchema.safeParse((await paramsPromise).spieltag_id);
  if (!parsed.success) notFound();

  return parsed.data;
}
