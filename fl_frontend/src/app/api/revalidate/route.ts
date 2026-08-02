/**
 * API · reference-data revalidation
 *
 * Backend-triggered cache invalidation for the three reference resources with no frontend write
 * surface. They are cached for a day, so an out-of-band edit is served stale until it expires.
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • NOT reachable from a browser, and that is the whole protection. nginx sends `/api` to FastAPI
 *     and only `/api/auth` to Next, so the only caller is inside the compose network. **Adding an
 *     nginx location for this path publishes it.**
 *   • The caller names a RESOURCE from a fixed enum, never a tag. Anything else is rejected before it
 *     reaches the cache.
 *   • `revalidateTag`, not `updateTag` — the latter throws in a Route Handler, where there is no
 *     read-your-own-writes to serve.
 *   • Logs name the rejected field, never the submitted value.
 *
 *  SEE ALSO ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 *   docs/frontend/spec.md — section 5 · docs/ops/spec.md — invariant I2
 */

import { timingSafeEqual } from "node:crypto";

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { z } from "zod";

import { frontend_config } from "@/core/config";
import { logger } from "@/core/logging";

import type { NextRequest } from "next/server";

// The caller names a resource, never a tag. Anything else is rejected before it reaches the cache.
// The only caller is `scripts/revalidate_reference_data.sh`, from inside the compose network.
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
  // Coarse base tag only: this resource has no granular tags to reach for (ADR-0001).
  revalidateTag(parsed.data.resource, "max");
  logger.info("revalidate.ok", { resource: parsed.data.resource });

  return new NextResponse(null, { status: 204 });
}
