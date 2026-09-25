import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

/* The real actions over their real `mutations.ts`: the client they send through and the request are
   the doubles. A file of its own, `actions.test.ts` replacing this slice's actions module for the
   components it renders. */
doubleActionRequest();

/** Every write acknowledged, with no link minted: the save then mails nothing. */
const sent = doubleApiClient(() => ({ acknowledged: 1, updated_document: null, bestaetigung: null }));

const { anonymiseSchiedsrichterAction, patchSchiedsrichterAction } = await import("./actions.ts");

const SCHIEDSRICHTER_ID = "68c1f0a2b3c4d5e6f7a8b9c0";

/** A referee the save's schema takes as it stands, so the rename reaches the doubled client rather than the parse. */
const REFEREE = { name: "Anna Beispiel", default_payment: 25, kontakt: { email: "anna@example.de", telefon: "069 1234567" }, schule: null };

/** The erasure's own report, the action having answered it. */
async function report(): Promise<string> {
  const result = await anonymiseSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

  assert.equal(result.success, true, "the erasure did not run, so its report is compared to nothing");
  return "message" in result ? String(result.message) : "";
}

/** Whether a write since the case began cleared the fixture reads' tag. */
const clearedSpiele = (): boolean => cacheCalls.some(({ name, args }) => name === "updateTag" && args[0] === "spiele");

beforeEach(() => {
  sent.length = 0;
});

describe("what the anonymisation moves", () => {
  /* A POST to `/anonymisieren`, never the DELETE beside it: that one stamps `inactive_since` and
     clears nothing. */
  it("calls the anonymisation endpoint and not the retire", async () => {
    await report();

    assert.deepEqual(
      sent.map(({ endpoint, method }) => ({ endpoint, method })),
      [{ endpoint: `/schiedsrichter/${SCHIEDSRICHTER_ID}/anonymisieren`, method: "POST" }],
    );
  });

  /* The one cached read it moves: the repointed booking lands on every Spiel as a rename does, and without
     the tag the erased name keeps being served from cache. The referee list and the log are uncached. */
  it("invalidates the fixture reads, as the rename does", async () => {
    await report();
    assert.ok(clearedSpiele(), "the anonymisation leaves the erased name in the fixture cache");

    cacheCalls.length = 0;
    const renamed = await patchSchiedsrichterAction({ id: SCHIEDSRICHTER_ID, ...REFEREE });
    assert.equal(renamed.success, true, "the rename did not run, so what it invalidates is compared to nothing");
    assert.ok(clearedSpiele(), "the rename stopped invalidating the one read a referee write does move");
  });
});

describe("what the anonymisation reports", () => {
  it("says a fixture without a result needs a new referee", async () => {
    const said = await report();

    assert.match(said, /Spiele ohne Ergebnis/, "the action's report does not name the fixtures the erasure unassigns");
    assert.match(said, /neuen Schiedsrichter/, "the action's report does not say such a fixture needs somebody else");
    assert.doesNotMatch(said, /behalten die Zuteilung/, "the action's report still promises the assignment survives the erasure");
  });

  /* Every other sentence about the erasure says „dieser Person“, and this one is the report an
     administrator forwards: a referee can be a woman, and the notice writes both forms. */
  it("reports the log redaction about a person rather than about a masculine referee", async () => {
    const said = await report();
    const redaction = said.slice(said.indexOf("Im Änderungsprotokoll"));

    assert.notEqual(redaction, said, "the report says nothing of the log, so its wording is compared to nothing");
    assert.match(redaction, /die diese Person betrifft/, "the report names the log rows by a masculine referee again");
  });

  /* `fl_backend/app/core/recording.py :: build_redaction_update` nulls the WHOLE pre-image of every
     row naming this referee, not the contact fields within it. */
  it("claims of the log what the redaction clears, and never the contact details alone", async () => {
    const said = await report();

    assert.match(said, /gesicherte[rn]? Stand/, "the action's report does not name the pre-image the log keeps");
    assert.doesNotMatch(said, /gelöscht, auch im Änderungsprotokoll/, "the report narrows the log to the two fields");
  });
});
