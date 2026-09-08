import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { EDGE_RATE_LIMIT_STATUS, postPublicForm } from "./publicSubmit.ts";

const FEATURES = path.resolve(import.meta.dirname, "..", "..", "features");

const read = (...parts: string[]): string => readFileSync(path.resolve(FEATURES, ...parts), "utf8");

/** Both public forms, each named as this file reports it. */
const FORMULARE: Record<string, string> = {
  "the application form": read("bewerbungen", "components", "forms", "BewerbungForm", "BewerbungForm.tsx"),
  "the confirmation panel": read("bewerbungen", "components", "views", "BestaetigungFormPanel.tsx"),
};

// The three sentences a visitor can be shown, spelled here rather than imported: what this file
// holds is the wording, and a test reading the module's own constant would agree with any rewording.
const ZU_VIELE_VERSUCHE = "Zu viele Versuche in kurzer Zeit. Warte einen Moment und versuche es dann noch einmal.";
const KEINE_ANTWORT_VON_UNS = "Die Antwort auf Deine Anfrage kam nicht von uns. Warte einen Moment und versuche es dann noch einmal.";
const KEINE_VERBINDUNG = "Prüfe Deine Verbindung und versuche es erneut.";

const ENVELOPE = { "content-type": "application/json" };

const ECHTES_FETCH = globalThis.fetch;

/** What the transport is made to do; every case here is something a real one produces. */
function transportiert(answer: (url: string, init: RequestInit) => Promise<Response>): void {
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => answer(String(input), init ?? {})) as typeof fetch;
}

const antwortet = (body: string, init: ResponseInit): void => {
  transportiert(() => Promise.resolve(new Response(body, init)));
};

afterEach(() => {
  globalThis.fetch = ECHTES_FETCH;
});

describe("what a public form is told when the answer was not this application's", () => {
  /* nginx generates the limit before any route handler runs, so the body is its own HTML and the
     status is the whole of what arrived. The wait is a repair, which is why it is said out loud. */
  it("names the wait on the edge's rate limit", async () => {
    antwortet("<html>429</html>", { status: EDGE_RATE_LIMIT_STATUS, headers: { "content-type": "text/html" } });

    const answered = await postPublicForm("/api/bewerbung", {});

    assert.deepEqual(answered, { answered: false, wroteNothing: true, error: ZU_VIELE_VERSUCHE });
  });

  /* A challenge reaching a POST at all is the edge misconfigured (`docs/ops/spec.md :: I177`), so
     both bodies: the shape a refusal from in front of us takes is nothing this side chose. */
  it("names no cause on a challenged POST, whatever the challenge answered with", async () => {
    for (const body of ["<html>challenge</html>", JSON.stringify({ success: false, error: "Forbidden" })]) {
      antwortet(body, { status: 403, headers: { "cf-mitigated": "challenge" } });

      const answered = await postPublicForm("/api/bewerbung", {});

      assert.deepEqual(
        answered,
        { answered: false, wroteNothing: false, error: KEINE_ANTWORT_VON_UNS },
        `the challenge answering ${body} reached the form`,
      );
    }
  });

  /* The same interstitial can arrive under a 200, where the status alone would pass it through as
     an answer of this application's. */
  it("refuses a body that is no JSON at all", async () => {
    antwortet("<html>interstitial</html>", { status: 200, headers: { "content-type": "text/html" } });

    const answered = await postPublicForm("/api/bestaetigung", {});

    assert.deepEqual(answered, { answered: false, wroteNothing: false, error: KEINE_ANTWORT_VON_UNS });
  });

  /* JSON parses from anything that wrote JSON, this application included in nothing about it. Every
     route's answer opens on `success`, so its absence is what separates the two. */
  it("refuses parsed JSON that is not the envelope", async () => {
    antwortet(JSON.stringify({ result: "ok" }), { status: 200, headers: ENVELOPE });

    const answered = await postPublicForm("/api/bewerbung", {});

    assert.deepEqual(answered, { answered: false, wroteNothing: false, error: KEINE_ANTWORT_VON_UNS });
  });

  /* A rejection reached no judgement, so the connection is the one thing worth naming and nothing
     the visitor typed may be. */
  it("blames the connection where the request left no judgement", async () => {
    transportiert(() => Promise.reject(new TypeError("Failed to fetch")));

    const answered = await postPublicForm("/api/bestaetigung", {});

    assert.deepEqual(answered, { answered: false, wroteNothing: false, error: KEINE_VERBINDUNG });
  });

  /* nginx refuses the REQUEST, so the write is ruled out and the form may say so; a challenge and a
     dead transport each leave a POST that may already have been written. */
  it("rules the write out on the edge's limit and on neither other refusal", async () => {
    for (const [name, arrange, wroteNothing] of [
      [
        "the rate limit",
        () => antwortet("<html>429</html>", { status: EDGE_RATE_LIMIT_STATUS, headers: { "content-type": "text/html" } }),
        true,
      ],
      ["the challenge", () => antwortet("<html>challenge</html>", { status: 403, headers: { "cf-mitigated": "challenge" } }), false],
      ["the dead transport", () => transportiert(() => Promise.reject(new TypeError("Failed to fetch"))), false],
    ] as const) {
      arrange();

      const answered = await postPublicForm("/api/bewerbung", {});

      assert.ok(!answered.answered, `${name}: the answer was taken for this application's`);
      assert.equal(answered.wroteNothing, wroteNothing, `${name}: what a form may tell a visitor about the write is wrong`);
    }
  });

  /* The refused arm carries a sentence and no map: a form laying field errors over its controls from
     an answer nothing in this application wrote would paint a refusal nobody made. */
  it("carries no field errors on any of them", async () => {
    for (const [name, init] of [
      ["the rate limit", { status: EDGE_RATE_LIMIT_STATUS, headers: ENVELOPE }],
      ["the challenge", { status: 403, headers: { ...ENVELOPE, "cf-mitigated": "challenge" } }],
    ] as const) {
      antwortet(JSON.stringify({ success: false, fieldErrors: { "schule.shorthand": "Kein Kürzel" } }), init);

      const answered = await postPublicForm("/api/bewerbung", {});

      assert.equal(answered.answered, false, `${name}: the answer was taken for this application's`);
      assert.ok(!Object.hasOwn(answered, "fieldErrors"), `${name}: a field error survived an answer this application never gave`);
    }
  });
});

describe("what a public form is told when the application did answer", () => {
  it("hands the envelope over whole, its refusal and its field errors with it", async () => {
    const envelope = { success: false, error: "Die Bewerbung wurde nicht gespeichert.", fieldErrors: { "schule.shorthand": "Schon vergeben" } };
    antwortet(JSON.stringify(envelope), { status: 200, headers: ENVELOPE });

    const answered = await postPublicForm("/api/bewerbung", {});

    assert.deepEqual(answered, { answered: true, body: envelope });
  });

  it("sends the payload as JSON on a POST", async () => {
    const sent: { url: string; init: RequestInit }[] = [];
    transportiert((url, init) => {
      sent.push({ url: url, init: init });
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: ENVELOPE }));
    });

    await postPublicForm("/api/bestaetigung", { token: "abc" });

    assert.deepEqual(
      sent.map(({ url }) => url),
      ["/api/bestaetigung"],
    );
    assert.equal(sent[0]?.init.method, "POST");
    assert.deepEqual(new Headers(sent[0]?.init.headers).get("content-type"), "application/json");
    assert.equal(sent[0]?.init.body, JSON.stringify({ token: "abc" }));
  });
});

describe("where each public form's write is transported", () => {
  /* Which transport a submit reaches is a call rather than an attribute, so it stands in no markup a
     render could be read for. A form spelling a write of its own regrows the copy this helper
     removed. */
  it("rides the shared helper to its own route, spelling no write of its own", () => {
    for (const [name, source] of Object.entries(FORMULARE)) {
      assert.ok(source.length > 0, `${name} is empty, so this case proves nothing about it`);
      assert.match(source, /postPublicForm<\w+>\("\/api\/\w+", payload\)/, `${name}: the write no longer rides the shared helper`);
      assert.ok(!source.includes('method: "POST"'), `${name}: the form spells a write of its own beside the shared one`);
    }
  });

  /* The Kürzel check is the one `fetch` left, and it is a READ: it refuses nothing, so a failure
     costs the applicant a courtesy rather than the submit, which judges the code again anyway. */
  it("leaves the availability check outside, the confirmation panel fetching nothing at all", () => {
    const [formular, panel] = [FORMULARE["the application form"] ?? "", FORMULARE["the confirmation panel"] ?? ""];

    assert.equal((formular.match(/\bfetch\(/g) ?? []).length, 1, "the application form spells a number of fetches other than the check's");
    assert.match(formular, /fetch\(`\/api\/bewerbung\/kuerzel\?/, "the one fetch left is not the availability check");
    assert.ok(!panel.includes("fetch("), "the confirmation panel spells a fetch of its own");
  });
});
