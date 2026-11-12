import { NextResponse } from "next/server";

import { z } from "zod";

import { logger } from "@/core/logging";
import { readTraceparent, TRACEPARENT_HEADER } from "@/core/trace";

import type { NextRequest } from "next/server";

// A boundary posts a crash only where it got no digest, a digest-bearing failure being the server's
// own line already, and the bot check's widget posts its failure with no stack, so the report is
// these three fields and no fourth.
const ClientErrorReportSchema = z.object({
  message: z.string().min(1).max(500),
  // Pathname only, so a caller cannot smuggle search text or tokens into the log.
  path: z
    .string()
    .max(300)
    .refine((value) => value.startsWith("/") && !value.includes("?"), "pathname only"),
  stack: z.string().max(4000).optional(),
});

/**
 * Public: the edge meters it per network and bounds its body, and nothing authenticates it —
 * `sec-fetch-site` and the schema bounds are all that stand in front of the log.
 */
export async function POST(request: NextRequest) {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite !== null && secFetchSite !== "same-origin") {
    return new NextResponse(null, { status: 403 });
  }

  const body: unknown = await request.json().catch(() => null);
  const report = ClientErrorReportSchema.safeParse(body);
  if (!report.success) {
    return new NextResponse(null, { status: 422 });
  }

  // The ingest request's own trace, not the crashed request's -- the browser cannot read that one.
  const incoming = readTraceparent(request.headers.get(TRACEPARENT_HEADER));

  logger.error("client.crash_reported", undefined, {
    trace_id: incoming,
    route: report.data.path,
    client_message: report.data.message,
    client_stack: report.data.stack,
  });

  return new NextResponse(null, { status: 204 });
}
