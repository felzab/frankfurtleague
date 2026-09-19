import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

/* Replaced at the module boundary, as `fl_frontend/src/shared/utils/undoRoute.test.ts` replaces them:
   a response is the framework's, and the spine between it and the handler is what is driven. */
const PACKAGE_DOUBLES: Record<string, string> = {
  "next/server": `export const NextResponse = { json: (body, init) => ({ body, status: init?.status ?? 200 }) };`,
  "next/headers": `export const headers = async () => { globalThis.__flPublicSpineTraces += 1; return new Headers(); };`,
};
const LOGGING = `export const logger = { info: () => {}, warn: () => {}, error: () => {} };`;

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { handlePublicRequest } = await import("./publicRoute.ts");

/** Every value a browser sends in `Sec-Fetch-Site`, and the browser too old to send any. */
const HERKUENFTE: readonly (string | null)[] = ["same-origin", "same-site", "cross-site", "none", null];

const zaehler = globalThis as unknown as Record<string, number>;

/** A request carrying `herkunft` as its header, or no header at all, whose body counts its own reads. */
function anfrage(herkunft: string | null, gelesen: { koerper: number }) {
  return {
    headers: new Headers(herkunft === null ? {} : { "sec-fetch-site": herkunft }),
    json: async () => {
      gelesen.koerper += 1;
      return {};
    },
  } as never;
}

/**
 * The spine driven: what it answered, and whether anything past its guard ran — a trace opened, a body
 * read, the handler itself. Every route carrying the guard is `fl_frontend/src/core/requestSpines.test.ts`'s population.
 */
async function durch(herkunft: string | null): Promise<{ status: number; body: { success: boolean; error?: string }; hatGearbeitet: boolean }> {
  zaehler.__flPublicSpineTraces = 0;
  const gelesen = { koerper: 0 };
  let lief = false;
  const antwort = (await handlePublicRequest(anfrage(herkunft, gelesen), {
    routeName: "publicRouteTest",
    run: async () => {
      lief = true;
      return { success: true };
    },
  })) as unknown as { status: number; body: { success: boolean; error?: string } };

  return { status: antwort.status, body: antwort.body, hatGearbeitet: lief || gelesen.koerper > 0 || zaehler.__flPublicSpineTraces > 0 };
}

describe("what stands in for a session on the public spine", () => {
  /* Every value a browser sends, so a widened condition or a refusal built and not returned fails;
     `null` passes deliberately, a browser too old to send the header still reading this page. */
  it("refuses every other origin, and lets the page's own requests and a header-less one through", async () => {
    for (const herkunft of HERKUENFTE) {
      const { body, hatGearbeitet } = await durch(herkunft);
      const fremd = herkunft !== null && herkunft !== "same-origin";

      assert.equal(hatGearbeitet, !fremd, `a request marked ${String(herkunft)} is ${fremd ? "worked on" : "turned away"}`);
      if (fremd) assert.match(body.error ?? "", /kam nicht von dieser Seite/, `a request marked ${herkunft} is answered with something else`);
    }
  });

  /* 200 with the outcome in the body, as the spine's own closing comment requires. */
  it("answers the refusal in German the caller actually renders", async () => {
    const { status, body } = await durch("cross-site");

    // Every caller throws on a non-2xx and reports the throw as a connection fault, which sends a
    // reader to check a network that is fine.
    assert.equal(status, 200, "the spine answers a status no caller reads past");
    assert.equal(body.success, false, "a cross-site request is reported as answered");
    assert.doesNotMatch(
      body.error ?? "",
      /Verbindung|Access Denied/,
      "a cross-site caller is sent to check their connection, or answered in English",
    );
  });
});
