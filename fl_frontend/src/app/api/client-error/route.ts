/**
 * APP · client-error ingest
 *
 * The one place a browser-side crash reaches the server log. Client components cannot use
 * `core/logging.ts` (it is server-only via `core/config.ts`), so without this route a client render
 * crash is recorded nowhere -- the error boundary posts here instead (`src/app/error.tsx`).
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • Strictly bounded input: every field is length-capped by the schema and anything unparseable is
 *     dropped with a 4xx and no log line an attacker controls the size of. This is a public,
 *     unauthenticated write path -- the only one besides sign-in -- which is why nginx rate-limits
 *     POSTs to it the same way (docs/logging.md).
 *   • Browser-only by intent: requests whose `Sec-Fetch-Site` is present and not `same-origin` are
 *     refused. Every current browser sends the header on fetch; a missing header (curl) still passes
 *     schema validation and the rate limit, which bounds the abuse to noise in a capped log.
 *   • No response body. The reporter gets a 204 either way it matters; this route must never become
 *     an oracle for anything.
 */

import { NextResponse } from "next/server";

import { z } from "zod";

import { CORRELATION_HEADER, isWellFormedCorrelationId } from "@/core/correlation";
import { logger } from "@/core/logging";

import type { NextRequest } from "next/server";

const ClientErrorReportSchema = z.object({
  message: z.string().min(1).max(500),
  // Client crashes have no digest; a server error rendered by the boundary carries one. Both kinds
  // may be reported, and the digest is what joins the server kind to its onRequestError line.
  digest: z.string().max(64).optional(),
  // The pathname only -- the boundary sends no query string, and the schema refuses one so a caller
  // cannot smuggle search text or tokens into the log.
  path: z
    .string()
    .max(300)
    .refine((value) => value.startsWith("/") && !value.includes("?"), "pathname only"),
  stack: z.string().max(4000).optional(),
});

export async function POST(request: NextRequest) {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return new NextResponse(null, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const report = ClientErrorReportSchema.safeParse(body);
  if (!report.success) {
    return new NextResponse(null, { status: 422 });
  }

  // The ingest request's own edge-minted id -- it does not name the request that crashed (the
  // browser cannot read that one), but it anchors this line to a time and an nginx access line.
  const incoming = request.headers.get(CORRELATION_HEADER);
  const correlationId = isWellFormedCorrelationId(incoming) ? incoming : undefined;

  logger.error("Client-side crash reported", undefined, {
    error_code: "FE-CLIENT-001",
    correlation_id: correlationId,
    digest: report.data.digest,
    route: report.data.path,
    client_message: report.data.message,
    client_stack: report.data.stack,
  });

  return new NextResponse(null, { status: 204 });
}
