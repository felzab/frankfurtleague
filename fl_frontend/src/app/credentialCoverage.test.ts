import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { keyTierOf } from "@/core/keyTiers.ts";
import { publishedOperations } from "@/core/openapiDocument.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";

import type { APIBadStatusError } from "@/core/errors.ts";
import type { KeyTier } from "@/core/keyTiers.ts";

/* The admin spine's guard, and the refresh its step-up refusal makes, doubled before the `await import`s below. */
doubleActionRequest();
registerHooks({
  // `next` publishes no `exports` map, so Node finds the subpath only with the extension a bundler would supply.
  resolve: (specifier, context, nextResolve) => nextResolve(specifier === "next/server" ? "next/server.js" : specifier, context),
});

const { NextRequest } = await import("next/server");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");
const { ZUGANG_WEG } = await import("@/shared/utils/actionError.ts");
const { runAdminMutation, stepUpRequired } = await import("@/shared/utils/adminMutation.ts");
const { handlePublicRequest } = await import("@/shared/utils/publicRoute.ts");

/** The credential class, whose codes `fl_frontend/src/core/errors.ts :: isRefusalCode` hands no slice mapper. */
const CREDENTIAL_CLASS = /^REQ-AUTH-/;

/** A code of that class the backend declares nowhere, answered as a code no reader names is. */
const UNCLAIMED = "REQ-AUTH-000";

/**
 * What a person meets for one code, and why: the words a spine answers it in, the answer any code of
 * the class no reader names gets, or nobody, a system caller logging what it is refused.
 */
type Answer =
  | { readonly kind: "worded"; readonly words: string; readonly because: string }
  | { readonly kind: "fallback"; readonly because: string }
  | { readonly kind: "nobody"; readonly because: string };

/**
 * Every credential code the document publishes, agreeing with it in both directions. A code it does
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
      "the guard signs the token only for a passkey session inside the administrator's window, so a refusal is the two services disagreeing on a key, a clock or that window",
  },
  "REQ-AUTH-009": {
    kind: "worded",
    words: stepUpRequired().error,
    because: "the page's next press asks for the confirmation the backend wants (`docs/frontend/spec.md :: I493`)",
  },
};

/** One credential code as the document publishes it: on which operation, at which status, under which key. */
type Published = { readonly operation: string; readonly code: string; readonly status: number; readonly tier: KeyTier | null };

const PUBLISHED: readonly Published[] = publishedOperations().flatMap(({ operation, declaration, answers }) =>
  answers
    .filter(({ code }) => CREDENTIAL_CLASS.test(code))
    .map(({ code, status }) => ({ operation, code, status, tier: keyTierOf(declaration) })),
);

/** RFC 9110's safe methods, which no write spine sends: a read hands every failure to its page's error boundary. */
const READS = /^(?:GET|HEAD|OPTIONS) /;

const errorOf = (answer: unknown): unknown => (typeof answer === "object" && answer !== null && "error" in answer ? answer.error : answer);

/** What the write spine for `tier` answers the refusal with, its body throwing it as the API client raises it. */
async function shownBySpine(tier: KeyTier | null, refusal: APIBadStatusError): Promise<unknown> {
  if (tier === "admin") return errorOf(await runAdminMutation("credentialCoverage", () => Promise.reject(refusal)));

  if (tier === "base") {
    const request = new NextRequest("http://localhost/api/credentialCoverage", {
      method: "POST",
      headers: { "sec-fetch-site": "same-origin" },
    });
    const response = await handlePublicRequest(request, { routeName: "credentialCoverage", run: () => Promise.reject(refusal) });

    return errorOf(await response.json());
  }

  throw new Error(`no write spine sends a ${String(tier)}-tier call; say who answers ${refusal.serverErrorCode ?? ""} there`);
}

describe("every published credential code against the answer a person meets", () => {
  /* Two listings reached by different routes, the document's and this table's, required to agree. */
  it("names an answer for exactly the credential codes the document publishes", () => {
    const published = [...new Set(PUBLISHED.map(({ code }) => code))];

    assert.deepEqual(
      published.filter((code) => !Object.hasOwn(ANSWERED, code)).sort(),
      [],
      "a published credential code no answer was chosen for: name the words a person meets, or why the fallback is right",
    );
    assert.deepEqual(
      Object.keys(ANSWERED)
        .filter((code) => !published.includes(code))
        .sort(),
      [],
      "an answer for a code the document does not publish",
    );
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

  /* Once per tier and status rather than per operation: no slice mapper reads a credential code, so the
     spine alone answers it. The system tier's callers show a refusal to nobody, as
     `fl_frontend/src/app/refusalCoverage.test.ts :: REFUSING` leaves them out. */
  it("answers each on every write spine that can meet it, as its entry says", async () => {
    const driven = new Set<string>();
    const asked = new Set<string>();
    for (const { operation, code, status, tier } of PUBLISHED) {
      const answer = ANSWERED[code];
      const key = `${code} at ${String(status)} under the ${String(tier)} key`;
      if (answer === undefined || answer.kind === "nobody" || tier === "system" || READS.test(operation) || asked.has(key)) continue;
      asked.add(key);

      const shown = await shownBySpine(tier, refusedOn(operation, code, status));
      const expected = answer.kind === "worded" ? answer.words : await shownBySpine(tier, refusedOn(operation, UNCLAIMED, status));
      assert.equal(shown, expected, `${key}: ${answer.because}`);
      driven.add(code);
    }

    // A code published on reads alone would pass above having been asked nothing.
    const undriven = Object.entries(ANSWERED)
      .filter(([code, { kind }]) => kind !== "nobody" && !driven.has(code))
      .map(([code]) => code);
    assert.deepEqual(undriven, [], "an answer no write publishing its code was asked about");
  });
});
