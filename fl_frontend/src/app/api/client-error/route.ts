import { NextResponse } from "next/server";

import { z } from "zod";

import { logger } from "@/core/logging";
import { readTraceparent, TRACEPARENT_HEADER } from "@/core/trace";

import type { NextRequest } from "next/server";

const ClientErrorReportSchema = z.object({
  message: z.string().min(1).max(500),
  // A client crash has no digest; a server error rendered by the boundary carries one, and it is
  // what joins this line to its onRequestError line.
  digest: z.string().max(64).optional(),
  // Pathname only, so a caller cannot smuggle search text or tokens into the log.
  path: z
    .string()
    .max(300)
    .refine((value) => value.startsWith("/") && !value.includes("?"), "pathname only"),
  stack: z.string().max(4000).optional(),
});

/**
 * Reachable the moment this file exists: nginx names no frontend route, so the catch-all carries
 * every path to Next (`docs/ops/overview.md :: Routing`). Nothing authenticates it —
 * `sec-fetch-site` and the schema bounds are all that stand in front of the log.
 */
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

  // The ingest request's own trace, not the crashed request's -- the browser cannot read that one.
  const incoming = readTraceparent(request.headers.get(TRACEPARENT_HEADER));

  logger.error("Client-side crash reported", undefined, {
    error_code: "FE-CLIENT-001",
    trace_id: incoming?.traceId,
    digest: report.data.digest,
    route: report.data.path,
    client_message: report.data.message,
    client_stack: report.data.stack,
  });

  return new NextResponse(null, { status: 204 });
}
