import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { documentsWrittenByAsync } from "@/core/stdoutCapture.ts";

const CONFIG_DOUBLE = { frontend_config: { LOG_FORMAT: "json", LOG_LEVEL: "INFO" } };

registerDoubles({
  modules: {
    "core/config.ts": CONFIG_DOUBLE,
  },
});

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

    assert.equal(status, 204);
    assert.equal(written.length, 1);
    const [document] = written;
    assert.equal(document?.error_code, "FE-CLIENT-001");
    assert.equal(document?.route, "/spiele");
    assert.equal(document?.trace_id, TRACE);
    assert.match(String(document?.span_id), /^[a-f0-9]{16}$/);
    assert.notEqual(document?.span_id, SPAN);
  });

  it("carries the sentinel on both ids where the header is malformed", async () => {
    const [document] = await documentsWrittenByAsync(() => POST(report({ traceparent: "PROBE-AAA" })));

    assert.equal(document?.trace_id, "SYSTEM");
    assert.equal(document?.span_id, "SYSTEM");
  });

  it("logs nothing for a cross-site caller", async () => {
    let status = 0;
    const written = await documentsWrittenByAsync(async () => {
      status = (await POST(report({ "sec-fetch-site": "cross-site" }))).status;
    });

    assert.equal(status, 403);
    assert.deepEqual(written, []);
  });
});
