/**
 * APP · client-error ingest
 *
 * The one place a browser-side crash reaches the server log. Client components cannot use
 * `core/logging.ts` (it is server-only via `core/config.ts`), so without this route a client
 * render crash is recorded nowhere — the error boundary posts here instead (`src/app/error.tsx`).
 *
 * Invariants:
 * - Bounded input: fields are length-capped, unparseable drops with a 4xx, nginx rate-limits the
 *   POSTs (docs/logging/spec.md).
 * - Requests whose `Sec-Fetch-Site` is present and not `same-origin` are refused.
 * - No response body — this route must never become an oracle for anything.
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
