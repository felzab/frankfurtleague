import { documentsWrittenByAsync } from "@/test-support/stdoutCapture.ts";
import { describe, expect, it } from "vitest";

const { POST } = await import("./route.ts");
const { NextRequest } = await import("next/server");

const TRACE = "a".repeat(32);

function report(headers: Record<string, string>): InstanceType<typeof NextRequest> {
  return new NextRequest("http://localhost/api/client-error", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    body: JSON.stringify({ message: "boom", path: "/spiele" }),
  });
}

// Run by the `unit-production` project under a production build's `NODE_ENV`: its JSON line is the one a reader
// joins to the edge's by its trace.
describe("POST /api/client-error", () => {
  // The route runs under no request scope, so the line's trace comes from the header it reads itself.
  it("logs the report under the ingest request's trace", async () => {
    let status = 0;
    const written = await documentsWrittenByAsync(async () => {
      status = (await POST(report({ traceparent: `00-${TRACE}-${"b".repeat(16)}-01` }))).status;
    });

    expect(status).toBe(204);
    expect(written).toMatchObject([{ message: "client.crash_reported", route: "/spiele", trace_id: TRACE }]);
  });

  // Nothing authenticates the route, so this check is all that stands between another site and the log.
  it("logs nothing for a cross-site caller", async () => {
    let status = 0;
    const written = await documentsWrittenByAsync(async () => {
      status = (await POST(report({ "sec-fetch-site": "cross-site" }))).status;
    });

    expect(status).toBe(403);
    expect(written).toStrictEqual([]);
  });
});
