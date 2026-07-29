import { timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { z } from "zod";

import { frontend_config } from "@/core/config";
import { logger } from "@/core/logging";

import type { NextRequest } from "next/server";

/**
 * Backend-triggered cache invalidation for the three reference resources that have no frontend
 * write surface (R3a §A1.4 / ledger Q5). They are cached with `cacheLife("days")`, so an
 * out-of-band edit -- Compass, an ad-hoc script -- is served stale for up to 24 hours.
 *
 * **This route is not reachable from a browser, and that is the point.** nginx sends `/api` to
 * FastAPI and only `/api/auth` to Next, so no external request ever arrives here. The only caller
 * is something already inside the compose network, at `http://frontend:3000/api/revalidate` --
 * see `scripts/revalidate_reference_data.sh`. Do not add an nginx location for this path.
 */

// The caller names a resource, never a tag. Anything else is rejected before it reaches the cache.
const RevalidatePayloadSchema = z.object({
  resource: z.enum(["saisons", "spieler", "spieltage"]),
});

function isAuthorized(header: string | null): boolean {
  const expected = frontend_config.INTERNAL_API_KEY_SYSTEM;
  const provided = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
  if (!provided) return false;

  // timingSafeEqual throws on a length mismatch, so compare lengths first -- that leak is the key's
  // length, which is fixed at 64 by config.ts and therefore not a secret.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request.headers.get("authorization"))) {
    logger.warn("revalidate.unauthorized");
    return new NextResponse(null, { status: 401 });
  }

  const parsed = RevalidatePayloadSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    // Names the field, never the submitted value.
    logger.warn("revalidate.bad_payload", { field: "resource" });
    return new NextResponse(null, { status: 400 });
  }

  // revalidateTag, not updateTag: updateTag throws in a Route Handler -- it exists for the
  // read-your-own-writes case in a Server Action, which this is not.
  // Coarse base tag only; the granular tags were deleted under ledger decision D2.
  revalidateTag(parsed.data.resource, "max");
  logger.info("revalidate.ok", { resource: parsed.data.resource });

  return new NextResponse(null, { status: 204 });
}
