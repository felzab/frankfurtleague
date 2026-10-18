import "server-only";

import { z } from "zod";

import { postRevalidation } from "./api";
import { logger } from "./logging";

/**
 * Every tag a caller of `fl_frontend/src/app/api/revalidate/route.ts` may name, and no other: the base tag of each
 * cached league read (`docs/frontend/spec.md` §1.2). A granular tag rides on its base tag's entries, so the base clears it.
 */
export const REVALIDATION_TAGS = ["saisons", "spiele", "spieler", "spieltage", "teams"] as const;

type RevalidationTag = (typeof REVALIDATION_TAGS)[number];

/** The route's whole body: a name off the list, at least one, and nothing beside them. */
export const RevalidationRequestSchema = z.strictObject({ tags: z.array(z.enum(REVALIDATION_TAGS)).min(1) });

/** What the route answers a drop it made; anything else dropped nothing (`docs/frontend/spec.md :: I16`). */
export const REVALIDATED = 204;

/**
 * Drops `tags` from outside a request, settling rather than throwing: a drop that failed leaves a cached page serving
 * what the caller just deleted, which the line tells the operator to drop by hand (`docs/ops/runbooks.md` §20).
 */
export async function revalidateOverLoopback(tags: readonly RevalidationTag[]): Promise<void> {
  try {
    const status = await postRevalidation(tags);
    if (status === REVALIDATED) return;

    logger.error("cache.revalidation_failed", undefined, { error_code: "FE-CACHE-001", status: status, tags: tags });
  } catch (error) {
    // The name alone: an `AbortError` or `TimeoutError` is the bound, anything else the loopback connection.
    logger.error("cache.revalidation_failed", undefined, {
      error_code: "FE-CACHE-001",
      name: error instanceof Error ? error.name : undefined,
      tags: tags,
    });
  }
}
