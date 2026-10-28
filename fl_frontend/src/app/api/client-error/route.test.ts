import { documentsWrittenByAsync } from "@/test-support/stdoutCapture.ts";
import { describe, expect, it, vi } from "vitest";

const CONFIG_DOUBLE = { frontend_config: { LOG_FORMAT: "json", LOG_LEVEL: "INFO" } };

vi.doMock("@/core/config.ts", () => CONFIG_DOUBLE);

const { POST } = await import("./route.ts");
const { NextRequest } = await import("next/server");

const TRACE = "a".repeat(32);
const SPAN = "b".repeat(16);

function report(headers: Record<string, string>): InstanceType<typeof NextRequest> {
  return new NextRequest("http://localhost/api/client-error", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
    body: JSON.stringify({ message: "boom", path: "/spiele" }),
  });
}

describe("POST /api/client-error", () => {
  // The route runs under no request scope, so the line's ids come from the header it reads itself;
  // a real trace beside the sentinel span would file the ingest under no hop (L12).
  it("logs the ingest request's trace under a span of this hop's own", async () => {
    let status = 0;
    const written = await documentsWrittenByAsync(async () => {
      status = (await POST(report({ traceparent: `00-${TRACE}-${SPAN}-01` }))).status;
    });

    expect(status).toBe(204);
    expect(written.length).toBe(1);
    const [document] = written;
    expect(document?.error_code).toBe("FE-CLIENT-001");
    expect(document?.route).toBe("/spiele");
    expect(document?.trace_id).toBe(TRACE);
    expect(String(document?.span_id)).toMatch(/^[a-f0-9]{16}$/);
    expect(document?.span_id).not.toBe(SPAN);
  });

  it("carries the sentinel on both ids where the header is malformed", async () => {
    const [document] = await documentsWrittenByAsync(() => POST(report({ traceparent: "PROBE-AAA" })));

    expect(document?.trace_id).toBe("SYSTEM");
    expect(document?.span_id).toBe("SYSTEM");
  });

  it("logs nothing for a cross-site caller", async () => {
    let status = 0;
    const written = await documentsWrittenByAsync(async () => {
      status = (await POST(report({ "sec-fetch-site": "cross-site" }))).status;
    });

    expect(status).toBe(403);
    expect(written).toStrictEqual([]);
  });
});
