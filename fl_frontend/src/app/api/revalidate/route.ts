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
 *   • A resource clears every tag whose CONTENT depends on it, not only its own — see `AFFECTED_TAGS`.
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

type RevalidateResource = z.infer<typeof RevalidatePayloadSchema>["resource"];

/**
 * Which cached reads a resource edit actually invalidates — not the same question as which resource
 * was edited.
 *
 * A season edit reaches three other resources, because a season is not just a row that `/saisons`
 * serves. It decides which season an omitted `saison_id` means (ADR-0002), so `/spiele`, `/spieltage`
 * and `/teams` all answer differently the moment `status: "active"` moves; and its `rules.win_points`
 * and `rules.draw_points` score the league table `/teams` derives from the matches (ADR-0026), so
 * changing the points scheme changes every table with no team document written. Clearing only
 * `saisons` leaves those serving the old answer for a day.
 *
 * The others reach nothing: `/spieler` takes a team, never a season, and a matchday is referenced by
 * matches without being copied into them.
 *
 * Over-invalidation is the intended trade. This runs by hand, a few times a year, after an edit made
 * in Compass — the cost is a handful of cold reads and the alternative is a stale public page.
 */
const AFFECTED_TAGS: Record<RevalidateResource, readonly string[]> = {
  saisons: ["saisons", "spiele", "spieltage", "teams"],
  spieler: ["spieler"],
  spieltage: ["spieltage"],
};

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
  // Coarse base tags only: none of these resources has granular tags to reach for (ADR-0001).
  const tags = AFFECTED_TAGS[parsed.data.resource];
  for (const tag of tags) revalidateTag(tag, "max");

  logger.info("revalidate.ok", { resource: parsed.data.resource, tags });

  return new NextResponse(null, { status: 204 });
}
