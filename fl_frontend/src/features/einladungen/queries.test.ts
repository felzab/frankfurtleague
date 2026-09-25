import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { NEXT_HEADERS_DOUBLE } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";

/**
 * `next/headers` resolves only inside a Next build. Answering no traceparent leaves each read
 * minting its own, which is the branch a request without one already takes.
 */
const HEADERS_DOUBLE_URL = `data:text/javascript,${encodeURIComponent(NEXT_HEADERS_DOUBLE)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: HEADERS_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { calls } = doubleApiAnswers(() => Promise.resolve({ acknowledged: 1, zeilen: [] }));

/** The path of every read, which for this module carries the question each one asks. */
const paths = (): string[] => calls.map(({ endpoint }) => endpoint);

const { getEinladung, getEinladungVersandVorschau } = await import("./queries.ts");

const TEAM_ID = "a".repeat(24);
const SAISON_ID = "2627";

beforeEach(() => {
  calls.length = 0;
});

describe("the invite slice's reads", () => {
  /* The preview describes the press it is shown before: read WITHOUT the re-send choice it answers
     over the other rule, and the page then lists one set of teams while the press writes to
     another. */
  it("carries the re-send choice into the preview's query string, both ways", async () => {
    await getEinladungVersandVorschau(SAISON_ID, false);
    await getEinladungVersandVorschau(SAISON_ID, true);

    assert.deepEqual(paths(), [
      `/saisons/${SAISON_ID}/einladungen/versand/vorschau?erneut=false`,
      `/saisons/${SAISON_ID}/einladungen/versand/vorschau?erneut=true`,
    ]);
  });

  it("addresses one team's invite by both ids in the path", async () => {
    await getEinladung(TEAM_ID, SAISON_ID);

    assert.deepEqual(paths(), [`/teams/${TEAM_ID}/saisons/${SAISON_ID}/einladung`]);
  });
});
