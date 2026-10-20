import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { APINetworkError } from "@/core/errors.ts";
import { registerDoubles } from "@/core/exportingModule.ts";
import { person } from "@/core/subjectFixtures.ts";
import { doubleEveryAction, doubleSubjectLookup } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answerReadsWith, EMPTIEST_ANSWER, renderPage } from "@/shared/testing/pageHarness.ts";
import { textOf } from "@/shared/testing/renderTest.ts";

registerDoubles({ modules: { "core/config.ts": { frontend_config: { SPIELBERICHT_EINGABE: "on" } } } });

doubleSubjectLookup(person({ schiedsrichter: [{ schiedsrichter_id: "68c1f0a2b3c4d5e6f7a8b9d1" }] }));
doubleEveryAction();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: PersoenlichSchiedsrichterPage } = await import("./page.tsx");

const BERICHTE_ENDPOINT = "/spielberichte/person";

describe("the referee's panel", () => {
  /* The page the Einteilung mail links to: a report list that cannot be read must not take the answers down with it. */
  it("stands when its report list cannot be read, and says so in that section", async () => {
    answerReadsWith((endpoint, schema, params) => {
      if (endpoint !== BERICHTE_ENDPOINT) return EMPTIEST_ANSWER(endpoint, schema, params);
      throw new APINetworkError({
        message: "Request failed.",
        url: BERICHTE_ENDPOINT,
        method: "GET",
        readOnly: true,
        traceId: "0",
        isTimeout: true,
      });
    });

    const text = textOf(await renderPage(underNext(h(PersoenlichSchiedsrichterPage))), " ");

    assert.ok(text.includes("Deine Spielberichte ließen sich gerade nicht lesen."), text);
    assert.ok(text.includes("Deine Einsätze"), "the fixtures to answer went down with the report list");
  });
});
