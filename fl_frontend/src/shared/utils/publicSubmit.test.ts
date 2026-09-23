import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

import { EDGE_RATE_LIMIT_STATUS, postPublicForm } from "./publicSubmit.ts";

const FEATURES = path.resolve(import.meta.dirname, "..", "..", "features");

const read = (...parts: string[]): string => readFileSync(path.resolve(FEATURES, ...parts), "utf8");

/** Every component under a feature slice that reaches the shared helper, found rather than listed. */
const REACHING_THE_HELPER = filesUnder(FEATURES, (name) => /\.tsx$/.test(name) && !isTestFile(name), 40)
  .filter((file) => file.includes(`${path.sep}components${path.sep}`) && readFileSync(file, "utf8").includes("postPublicForm"))
  .map((file) => path.relative(FEATURES, file).split(path.sep).join("/"));

/** Every public form a visitor can submit, each named as this file reports it. */
const FORMULAR_PFADE: Record<string, string> = {
  "the application form": "bewerbungen/components/forms/BewerbungForm/BewerbungForm.tsx",
  "the confirmation panel": "bewerbungen/components/views/BestaetigungFormPanel.tsx",
  "the referee's confirmation page": "schiedsrichter/components/views/SchiedsrichterBestaetigungView.tsx",
  "the registration form": "registrierungen/components/views/RegistrierungFormPanel.tsx",
  "the pupil's confirmation page": "registrierungen/components/views/SpielerBestaetigungView.tsx",
};

const FORMULARE: Record<string, string> = Object.fromEntries(
  Object.entries(FORMULAR_PFADE).map(([name, relativ]) => [name, read(...relativ.split("/"))]),
);

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

    const answered = await postPublicForm("/api/bestaetigung/kontakt", {});

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

    const answered = await postPublicForm("/api/bestaetigung/kontakt", {});

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

    await postPublicForm("/api/bestaetigung/kontakt", { token: "abc" });

    assert.deepEqual(
      sent.map(({ url }) => url),
      ["/api/bestaetigung/kontakt"],
    );
    assert.equal(sent[0]?.init.method, "POST");
    assert.deepEqual(new Headers(sent[0]?.init.headers).get("content-type"), "application/json");
    assert.equal(sent[0]?.init.body, JSON.stringify({ token: "abc" }));
  });
});

describe("where each public form's write is transported", () => {
  /* The population is CLOSED against the tree: a sixth form reaching the helper joins the two cases
     below by existing, rather than by somebody remembering to name it here. */
  it("names every component that reaches the shared helper, and none that does not", () => {
    assert.deepEqual([...REACHING_THE_HELPER].sort(), Object.values(FORMULAR_PFADE).sort());
  });

  /* Which transport a submit reaches is a call rather than an attribute, so it stands in no markup a
     render could be read for. A form spelling a write of its own regrows the copy this helper
     removed. */
  it("rides the shared helper to its own route, spelling no write of its own", () => {
    for (const [name, source] of Object.entries(FORMULARE)) {
      assert.ok(source.length > 0, `${name} is empty, so this case proves nothing about it`);
      // `[\w/]+` rather than one segment: a confirmation's route is `/api/bestaetigung/<type>`, and a
      // single-segment pattern reads a form that moved under a segment as one that stopped riding.

      // The argument is read as any identifier: what this case grades is the call, and a page naming
      // its body something else was being reported as one that spells a write of its own.
      assert.match(
        source,
        /postPublicForm<\w+>\("\/api\/[\w/]+", \w+(?:, \{ idempotencyKey: \w+ \})?\)/,
        `${name}: the write no longer rides the shared helper`,
      );
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

describe("the title a form raises where the write may already have landed", () => {
  /* Which title an arm raises is a call rather than an attribute, so it stands in no markup a render
     could be read for — the reason the two cases above read these files. */
  // The `wroteNothing` arm is admitted as an identifier as well: a page raising that title at more
  // than one site names it once, and only the SHARED arm below is this case's subject.
  const geteilterTitel = (source: string): string | undefined =>
    /appToast\.danger\(gesendet\.wroteNothing \? (?:"[^"]+"|\w+) : "([^"]+)"/.exec(source)?.[1];

  /* One title over both sentences above: a word of either in it says that branch's fact twice and
     makes the title read as the other branch's cause. Five letters skips shared function words. */
  it("shares no word with either sentence it can be shown over", () => {
    const woerter = (satz: string): string[] => (satz.match(/\p{L}{5,}/gu) ?? []).map((wort) => wort.toLowerCase());
    const beschrieben = new Set([...woerter(KEINE_VERBINDUNG), ...woerter(KEINE_ANTWORT_VON_UNS)]);
    assert.ok(beschrieben.size > 0, "neither description carries a word long enough for this case to find in a title");

    for (const [name, source] of Object.entries(FORMULARE)) {
      const titel = geteilterTitel(source);
      assert.ok(titel !== undefined, `${name}: the arm that cannot rule the write out raises no title this case can read`);
      assert.deepEqual(
        woerter(titel).filter((wort) => beschrieben.has(wort)),
        [],
        `${name}: the title repeats a word of the sentence under it`,
      );
    }
  });
});
