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

const { handlePublicRequest, SCHON_VORLIEGEND } = await import("./publicRoute.ts");
const { toActionErrorResult } = await import("./actionError.ts");
const { markOutcomeUnknown } = await import("@/core/requestScope");
const { DUPLICATE_KEY, refusedOn } = await import("@/shared/testing/publishedRefusals.ts");

/** Every value a browser sends in `Sec-Fetch-Site`, and the browser too old to send any. */
const ORIGINS: readonly (string | null)[] = ["same-origin", "same-site", "cross-site", "none", null];

const counters = globalThis as unknown as Record<string, number>;

/** A request carrying `origin` as its header, or no header at all, whose body counts its own reads. */
function request(origin: string | null, read: { body: number }, method = "POST") {
  return {
    method: method,
    headers: new Headers(origin === null ? {} : { "sec-fetch-site": origin }),
    json: async () => {
      read.body += 1;
      return {};
    },
  } as never;
}

/**
 * The spine driven: what it answered, and whether anything past its guard ran — a trace opened, a body
 * read, the handler itself. Every route carrying the guard is `fl_frontend/src/core/requestSpines.test.ts`'s population.
 */
async function answerFor(origin: string | null): Promise<{ status: number; body: { success: boolean; error?: string }; didWork: boolean }> {
  counters.__flPublicSpineTraces = 0;
  const read = { body: 0 };
  let ran = false;
  const answer = (await handlePublicRequest(request(origin, read), {
    routeName: "publicRouteTest",
    run: async () => {
      ran = true;
      return { success: true };
    },
  })) as unknown as { status: number; body: { success: boolean; error?: string } };

  return { status: answer.status, body: answer.body, didWork: ran || read.body > 0 || counters.__flPublicSpineTraces > 0 };
}

describe("what stands in for a session on the public spine", () => {
  /* Every value a browser sends, so a widened condition or a refusal built and not returned fails;
     `null` passes deliberately, a browser too old to send the header still reading this page. */
  it("refuses every other origin, and lets the page's own requests and a header-less one through", async () => {
    for (const origin of ORIGINS) {
      const { body, didWork } = await answerFor(origin);
      const isCrossOrigin = origin !== null && origin !== "same-origin";

      assert.equal(didWork, !isCrossOrigin, `a request marked ${String(origin)} is ${isCrossOrigin ? "worked on" : "turned away"}`);
      if (isCrossOrigin)
        assert.match(body.error ?? "", /kam nicht von dieser Seite/, `a request marked ${origin} is answered with something else`);
    }
  });

  /* 200 with the outcome in the body, as the spine's own closing comment requires. */
  it("answers the refusal in German the caller actually renders", async () => {
    const { status, body } = await answerFor("cross-site");

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

describe("a refusal the route itself leaves unmapped", () => {
  const refusedWith = async (serverErrorCode: string) =>
    (
      (await handlePublicRequest(request("same-origin", { body: 0 }), {
        routeName: "publicRouteTest",
        run: async () => {
          throw refusedOn("POST /registrierungen", serverErrorCode);
        },
      })) as unknown as { body: unknown }
    ).body;

  /* The shared reader's sentence for it is an administrator's, about an entry they can open; a visitor
     on a public form has none, and reads that their details are already on file. */
  it("answers the unique index's refusal in the visitor's own words", async () => {
    assert.deepEqual(await refusedWith(DUPLICATE_KEY), { success: false, error: SCHON_VORLIEGEND });
    assert.notEqual(SCHON_VORLIEGEND, toActionErrorResult(refusedOn("POST /registrierungen", DUPLICATE_KEY)).error);
  });

  it("leaves every other conflict to the shared reader", async () => {
    const refusal = refusedOn("POST /registrierungen", "REQ-UNCLAIMED-000");

    assert.deepEqual(await refusedWith("REQ-UNCLAIMED-000"), toActionErrorResult(refusal, { method: "POST", readOnly: false }));
  });
});

describe("a throw of the route's own code", () => {
  const thrownBy = async (method: string) =>
    (
      (await handlePublicRequest(request("same-origin", { body: 0 }, method), {
        routeName: "publicRouteTest",
        run: async () => {
          throw new RangeError("Invalid time value");
        },
      })) as unknown as { body: { success: boolean; error?: string; outcome?: string } }
    ).body;

  /* The application route formats a date and composes its mails after the write, so a throw there
     leaves the row standing: answered as a failure, the applicant sends it again. */
  it("answers a POST as of unknown outcome, the write perhaps standing", async () => {
    assert.equal((await thrownBy("POST")).outcome, "unknown");
  });

  it("answers a GET, which wrote nothing, as the failure it is", async () => {
    const body = await thrownBy("GET");

    assert.equal(body.outcome, undefined);
    assert.equal(body.error, "Lade die Seite neu und versuche es erneut.");
  });
});

describe("a public route whose request left a call's outcome unknown", () => {
  /** A route settling such a call among its own answers, as a mail fan-out settles a broken send. */
  const settledBy = async (method: string) =>
    (
      (await handlePublicRequest(request("same-origin", { body: 0 }, method), {
        routeName: "publicRouteTest",
        run: async () => {
          markOutcomeUnknown();
          return { success: true, message: "Deine Bewerbung ist eingegangen." };
        },
      })) as unknown as { body: { success: boolean; message?: string; outcome?: string } }
    ).body;

  /* The application route stores its row and then mails: a confirmation that may have gone, answered
     as a clean success or a clean failure, tells the visitor something nobody knows. */
  it("answers a POST as of unknown outcome, whatever the route answered itself", async () => {
    assert.equal((await settledBy("POST")).outcome, "unknown");
  });

  it("answers a GET, which wrote nothing, with what it answered itself", async () => {
    assert.deepEqual(await settledBy("GET"), { success: true, message: "Deine Bewerbung ist eingegangen." });
  });
});
