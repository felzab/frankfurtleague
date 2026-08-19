import { NextResponse } from "next/server";

import { z } from "zod";

import { CORRELATION_HEADER, isWellFormedCorrelationId } from "@/core/correlation";
import { logger } from "@/core/logging";

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

  // The ingest request's own id, not the crashed request's -- the browser cannot read that one.
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
