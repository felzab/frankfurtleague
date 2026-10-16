import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { presentsSystemKey } from "@/core/api";
import { logger } from "@/core/logging";
import { REVALIDATED, RevalidationRequestSchema } from "@/core/revalidation";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { NextRequest } from "next/server";

/**
 * Reached over loopback alone, by the hourly deletion and by an operator after a hand edit; nginx refuses it at the
 * edge (`docs/frontend/spec.md :: I16`). Off `handlePublicRequest`, which answers 200 whatever happened: both callers
 * act on the status.
 */
export async function POST(request: NextRequest) {
  // The cross-site guard every session-less handler stands behind, which a server-side `fetch` passes by sending none.
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return new NextResponse(null, { status: 403 });
  }

  // Judged before the body, so a caller without the key learns nothing of which tags exist. Never the header's value.
  if (!presentsSystemKey(request.headers.get("authorization"))) {
    logger.warn("cache.revalidation_refused", { error_code: "FE-CACHE-001", field: "authorization" });
    return new NextResponse(null, { status: 401 });
  }

  const body = RevalidationRequestSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    logger.warn("cache.revalidation_refused", { error_code: "FE-CACHE-001", field: "tags" });
    return new NextResponse(null, { status: 422 });
  }

  return runWithIncomingTrace(async () => {
    // `{ expire: 0 }`: the caller has just deleted what the entry holds, and a stale-while-revalidate profile serves it
    // once more (`docs/frontend/spec.md :: I14`).
    for (const tag of body.data.tags) revalidateTag(tag, { expire: 0 });

    logger.info("cache.revalidated", { tags: body.data.tags });
    return new NextResponse(null, { status: REVALIDATED });
  });
}
