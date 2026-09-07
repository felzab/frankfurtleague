import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

const CONFIG_DOUBLE = `export const frontend_config = { LOG_FORMAT: "json", LOG_LEVEL: "INFO" };`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    // Node resolves the package's subpath only with its extension; Next's own bundler needs none.
    if (specifier === "next/server") return nextResolve("next/server.js", context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
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

/**
 * The documents `run` wrote to stdout while it ran. The runner's own reporter shares the stream, so
 * a chunk that is not a document passes through untouched.
 */
async function documentsWrittenBy(run: () => Promise<unknown>): Promise<Record<string, unknown>[]> {
  const documents: Record<string, unknown>[] = [];
  const original = process.stdout.write;
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    const text = String(chunk);
    if (!text.startsWith("{")) return (original as (...args: unknown[]) => boolean).call(process.stdout, chunk, ...rest);
    documents.push(JSON.parse(text) as Record<string, unknown>);
    return true;
  }) as typeof process.stdout.write;
  try {
    await run();
  } finally {
    process.stdout.write = original;
  }
  return documents;
}

describe("POST /api/client-error", () => {
  // The route runs under no request scope, so the line's ids come from the header it reads itself;
  // a real trace beside the sentinel span would file the ingest under no hop (L12).
  it("logs the ingest request's trace under a span of this hop's own", async () => {
    let status = 0;
    const written = await documentsWrittenBy(async () => {
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
    const [document] = await documentsWrittenBy(() => POST(report({ traceparent: "PROBE-AAA" })));

    assert.equal(document?.trace_id, "SYSTEM");
    assert.equal(document?.span_id, "SYSTEM");
  });

  it("logs nothing for a cross-site caller", async () => {
    let status = 0;
    const written = await documentsWrittenBy(async () => {
      status = (await POST(report({ "sec-fetch-site": "cross-site" }))).status;
    });

    assert.equal(status, 403);
    assert.deepEqual(written, []);
  });
});
