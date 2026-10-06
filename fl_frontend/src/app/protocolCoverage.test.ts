import assert from "node:assert/strict";
import { describe, it } from "node:test";

import z from "zod";

import { PROTOCOL_FAMILIES } from "@/core/errors.ts";
import { keyTierOf } from "@/core/keyTiers.ts";
import { publishedOperations } from "@/core/openapiDocument.ts";
import { person, sitz, SITZ } from "@/core/subjectFixtures.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";

import type { APIBadStatusError } from "@/core/errors.ts";
import type { KeyTier } from "@/core/keyTiers.ts";

/* The admin spine's guard, the person spine's lookup holding a seat, and the refresh a step-up refusal
   makes, doubled before the `await import`s below. */
doubleActionRequest({ subject: person({ sitze: [sitz()] }) });

const { NextRequest } = await import("next/server");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");
const { GESPERRT_KEINE_AENDERUNG, HEUTE_GENUG_GEAENDERT, ZUGANG_WEG } = await import("@/shared/utils/actionError.ts");
const { runAdminMutation, stepUpRequired } = await import("@/shared/utils/adminMutation.ts");
const { runPersonMutation, runPersonRecordMutation } = await import("@/shared/utils/personMutation.ts");
const { handlePublicRequest } = await import("@/shared/utils/publicRoute.ts");
const { handleUndoRequest } = await import("@/shared/utils/undoRoute.ts");

/** The shared reader's words for a request the running API cannot take, which a slice's own mapper may word first. */
const EINZELNE_ANGABEN_ABGELEHNT = "Einzelne Angaben wurden nicht übernommen. Lade die Seite neu.";

/** The router answers it where no operation matched, so no operation publishes a code of it. */
const ROUTE_FAMILY = "ROUTE";

/**
 * The families whose codes `fl_frontend/src/core/errors.ts :: isRefusalCode` hands no slice mapper, read off its list
 * so a family added there is asked here.
 */
const SPINE_FAMILIES = PROTOCOL_FAMILIES.filter((family) => family !== ROUTE_FAMILY);
const SPINE_CODE = new RegExp(`^REQ-(?:${SPINE_FAMILIES.join("|")})-`);

/** A code of the same class the backend declares nowhere, answered as a code no reader names is. */
const unclaimedBeside = (code: string): string => code.replace(/\d{3}$/, "000");

/**
 * What a person meets for one code, and why: the words a spine answers it in, the answer any code of
 * the class no reader names gets, or nobody, a system caller logging what it is refused.
 */
type Answer =
  | { readonly kind: "worded"; readonly words: string; readonly because: string }
  | { readonly kind: "fallback"; readonly because: string }
  | { readonly kind: "nobody"; readonly because: string };

/**
 * Every code of those classes the document publishes, agreeing with it in both directions. A code it does
 * not yet publish has no entry: the first operation publishing one fails here until its answer is chosen.
 */
const ANSWERED: Readonly<Record<string, Answer>> = {
  "REQ-AUTH-001": {
    kind: "fallback",
    because: "the API client sends its tier's key on every call, so a request carrying none is this application's fault",
  },
  "REQ-AUTH-002": {
    kind: "fallback",
    because: "the base key is the deployment's, the same for every visitor, so no visitor can repair its refusal",
  },
  "REQ-AUTH-003": { kind: "nobody", because: "only the system key's callers meet it, and each logs a refusal" },
  "REQ-AUTH-004": {
    kind: "fallback",
    because: "the admin key is the deployment's, the same for every administrator, so none can repair its refusal",
  },
  "REQ-AUTH-005": {
    kind: "fallback",
    because: "the API client refuses to send an admin call naming nobody, so the backend meeting one is this application's fault",
  },
  "REQ-AUTH-006": {
    kind: "worded",
    words: ZUGANG_WEG,
    because: "the grant went between the guard and the call, so a retry and a sign-in meet the same refusal",
  },
  "REQ-AUTH-007": {
    kind: "fallback",
    because:
      "each lane's guard signs the token only for a session its lane admits, an administrator's passkey session inside the window and made since its grant or a person's inside the person's lifetime, so a refusal is the two services disagreeing on a key, a clock, a window or the grant read",
  },
  "REQ-AUTH-008": {
    kind: "worded",
    words: GESPERRT_KEINE_AENDERUNG,
    because:
      "the person binder reads the ban on every request, so the address was barred after its session was judged, and no retry or sign-in lifts a ban",
  },
  "REQ-AUTH-009": {
    kind: "worded",
    words: stepUpRequired().error,
    because: "the page's next press asks for the confirmation the backend wants (`docs/frontend/spec.md :: I493`)",
  },
  "REQ-VAL-001": {
    kind: "worded",
    words: EINZELNE_ANGABEN_ABGELEHNT,
    because: "a body no rendered control takes comes from a page older than the running API, which a reload replaces and a retry resends",
  },
  "REQ-VAL-002": {
    kind: "worded",
    words: EINZELNE_ANGABEN_ABGELEHNT,
    because: "a retry resends the unreadable body unchanged, and only a reload replaces the page that built it",
  },
  "REQ-DROSSELUNG-001": {
    kind: "worded",
    words: HEUTE_GENUG_GEAENDERT,
    because: "the count starts again at German midnight, so a retry and a sign-in meet the same refusal before then",
  },
};

/** One such code as the document publishes it: on which operation, at which status, under which key. */
type Published = { readonly operation: string; readonly code: string; readonly status: number; readonly tier: KeyTier | null };

const PUBLISHED: readonly Published[] = publishedOperations().flatMap(({ operation, declaration, answers }) =>
  answers.filter(({ code }) => SPINE_CODE.test(code)).map(({ code, status }) => ({ operation, code, status, tier: keyTierOf(declaration) })),
);

/** RFC 9110's safe methods, which no write spine sends: a read hands every failure to its page's error boundary. */
const READS = /^(?:GET|HEAD|OPTIONS) /;

/**
 * A person's route under the admin key, told apart by the refusal only the person binder raises: its
 * writes are sent by a person's action alone, never by an admin action or an undo route.
 */
const PERSON_ROUTES = new Set(PUBLISHED.filter(({ code }) => code === "REQ-AUTH-008").map(({ operation }) => operation));

/**
 * The person routes whose actions claim the person's own record rather than a seat
 * (`fl_frontend/src/shared/utils/personActionSpine.test.ts :: CLAIMS_A_RECORD`), so their writes run
 * behind the record entry and are asked through it.
 */
const RECORD_ROUTES: ReadonlySet<string> = new Set([
  "PATCH /spieler/selbst/einwilligung",
  "PATCH /schiedsrichter/selbst/{schiedsrichter_id}/einwilligung",
  "PATCH /teams/{team_id}/saisons/{saison_id}/person/einwilligung",
  "PATCH /bewerbungen/{bewerbung_id}/person/einwilligung",
]);

const errorOf = (answer: unknown): unknown => (typeof answer === "object" && answer !== null && "error" in answer ? answer.error : answer);

/** A same-origin request to a route, carrying an empty body for a spine that parses one. */
const routeRequest = (path: string) =>
  new NextRequest(`http://localhost${path}`, { method: "POST", headers: { "sec-fetch-site": "same-origin" }, body: "{}" });

/**
 * What each of `tier`'s write spines answers the refusal with, its body throwing it as the API client
 * raises it: an admin write is sent by an action and replayed by an undo route, each answering itself.
 */
async function shownBySpines(
  tier: KeyTier | null,
  person: "seat" | "record" | null,
  refusal: APIBadStatusError,
): Promise<Readonly<Record<string, unknown>>> {
  // A person's record write is sent by the record entry alone, which judges the session and nothing more.
  if (tier === "admin" && person === "record") {
    return { "the person record spine": errorOf(await runPersonRecordMutation("protocolCoverage", () => Promise.reject(refusal))) };
  }

  // A person's seat write is sent by the seat entry alone, for a seat the doubled lookup holds.
  if (tier === "admin" && person === "seat") {
    const seat = { team_id: SITZ.team_id, saison_id: SITZ.saison_id };

    return { "the person action spine": errorOf(await runPersonMutation("protocolCoverage", seat, () => Promise.reject(refusal))) };
  }

  if (tier === "admin") {
    const undone = await handleUndoRequest(routeRequest("/api/admin/protocolCoverage/undo"), {
      mutationName: "protocolCoverage",
      schema: z.object({}),
      restore: () => Promise.reject(refusal),
      tags: () => [],
    });

    return {
      "the action spine": errorOf(await runAdminMutation("protocolCoverage", () => Promise.reject(refusal))),
      "the undo spine": errorOf(await undone.json()),
    };
  }

  if (tier === "base") {
    const response = await handlePublicRequest(routeRequest("/api/protocolCoverage"), {
      routeName: "protocolCoverage",
      run: () => Promise.reject(refusal),
    });

    return { "the public route spine": errorOf(await response.json()) };
  }

  throw new Error(`no write spine sends a ${String(tier)}-tier call; say who answers ${refusal.serverErrorCode ?? ""} there`);
}

describe("every published credential, request-validation and day-ceiling code against the answer a person meets", () => {
  /* Two listings reached by different routes, the document's and this table's, required to agree. */
  it("names an answer for exactly the codes of those classes the document publishes", () => {
    const published = [...new Set(PUBLISHED.map(({ code }) => code))];

    assert.deepEqual(
      published.filter((code) => !Object.hasOwn(ANSWERED, code)).sort(),
      [],
      "a published code of those classes no answer was chosen for: name the words a person meets, or why the fallback is right",
    );
    assert.deepEqual(
      Object.keys(ANSWERED)
        .filter((code) => !published.includes(code))
        .sort(),
      [],
      "an answer for a code the document does not publish",
    );
  });

  /* A stale exclusion would leave the families asked above as they were while one of them went unasked. */
  it("leaves out only the routing family, which the protocol holds and no operation publishes", () => {
    assert.ok(PROTOCOL_FAMILIES.includes(ROUTE_FAMILY), `${ROUTE_FAMILY} is no longer a protocol family`);
    const routing = publishedOperations().flatMap(({ answers }) => answers.filter(({ code }) => code.startsWith(`REQ-${ROUTE_FAMILY}-`)));
    assert.deepEqual(routing, [], "an operation publishes a routing code, which no case here asks about");
  });

  it("publishes a code nobody is shown on the system tier alone", () => {
    for (const [code, answer] of Object.entries(ANSWERED)) {
      if (answer.kind !== "nobody") continue;

      const reaching = PUBLISHED.filter((published) => published.code === code && published.tier !== "system").map(
        ({ operation }) => operation,
      );
      assert.deepEqual(reaching, [], `${code} reaches a person, so ${answer.because} no longer holds`);
    }
  });

  /* A name here the document does not publish as a person's route is asked about nothing, and the
     route it meant is asked through the seat entry its action never runs on. */
  it("names as a record route only person routes the document publishes", () => {
    assert.deepEqual(
      [...RECORD_ROUTES].filter((operation) => !PERSON_ROUTES.has(operation)),
      [],
      "a record route named here is no published person route",
    );
  });

  /* Once per tier and status on each of its spines, not per operation: an operation whose mapper leaves
     a code unworded answers it as its spine does. System callers show nobody a refusal, as
     `fl_frontend/src/app/refusalCoverage.test.ts :: REFUSING` leaves them out. */
  it("answers each on every write spine that can meet it, as its entry says", async () => {
    const driven = new Set<string>();
    const asked = new Set<string>();
    for (const { operation, code, status, tier } of PUBLISHED) {
      const answer = ANSWERED[code];
      const person = !PERSON_ROUTES.has(operation) ? null : RECORD_ROUTES.has(operation) ? "record" : "seat";
      const key = `${code} at ${String(status)} under the ${String(tier)} key${person === null ? "" : ` on a person's ${person} route`}`;
      if (answer === undefined || answer.kind === "nobody" || tier === "system" || READS.test(operation) || asked.has(key)) continue;
      asked.add(key);

      const shown = await shownBySpines(tier, person, refusedOn(operation, code, status));
      const unclaimed =
        answer.kind === "worded" ? null : await shownBySpines(tier, person, refusedOn(operation, unclaimedBeside(code), status));
      for (const [spine, words] of Object.entries(shown)) {
        assert.equal(words, answer.kind === "worded" ? answer.words : unclaimed?.[spine], `${key}, on ${spine}: ${answer.because}`);
      }
      driven.add(code);
    }

    // A code published on reads alone would pass above having been asked nothing.
    const undriven = Object.entries(ANSWERED)
      .filter(([code, { kind }]) => kind !== "nobody" && !driven.has(code))
      .map(([code]) => code);
    assert.deepEqual(undriven, [], "an answer no write publishing its code was asked about");
  });
});
