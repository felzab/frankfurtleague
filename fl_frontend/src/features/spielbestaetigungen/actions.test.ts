import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { spielbestaetigungFields } from "@/shared/testing/fixtures.ts";
import { answerShown, assertEachAnswered, publishedRefusals } from "@/shared/testing/publishedRefusals.ts";

import { mapSpielbestaetigungAdminRefusal } from "./utils.ts";

/* The real actions and their mutations, called: the request they run in and the backend client are the doubles. */
doubleActionRequest();
const ZEILE = spielbestaetigungFields();
const client = doubleApiAnswers(() => Promise.resolve({ acknowledged: 1, updated_document: ZEILE }));

/* `await import`, after the doubles the actions load. */
const { eintragenSpielbestaetigungAction, verwerfenSpielbestaetigungAction } = await import("./actions.ts");

const EINTRAGEN = "POST /spielbestaetigungen/{spielbestaetigung_id}/eintragen";
const VERWERFEN = "POST /spielbestaetigungen/{spielbestaetigung_id}/verwerfen";

const eintragen = () => eintragenSpielbestaetigungAction({ id: ZEILE.id, begruendung: "Die Trainerin hat am Telefon zugesagt." });
const verwerfen = () => verwerfenSpielbestaetigungAction({ id: ZEILE.id });

describe("the administrator's settle and discard", () => {
  it("reach each published path, the id in the path and the reason alone in the settle's body", async () => {
    const sent = client.calls.length;
    await eintragen();
    await verwerfen();

    assert.deepEqual(requestsOf(client.calls.slice(sent)), [
      {
        endpoint: `/spielbestaetigungen/${ZEILE.id}/eintragen`,
        method: "POST",
        body: { begruendung: "Die Trainerin hat am Telefon zugesagt." },
      },
      { endpoint: `/spielbestaetigungen/${ZEILE.id}/verwerfen`, method: "POST", body: undefined },
    ]);
  });

  /* A settle can complete the pair the public card's verdict reads, and a discard moves which rows the verdict counts:
     without the drop „Vorläufig“ stands on a confirmed fixture for a cache window, nothing failing. */
  for (const [name, press] of [
    ["settle", eintragen],
    ["discard", verwerfen],
  ] as const) {
    it(`drops the fixtures' tag on a landed ${name}`, async () => {
      assert.equal((await press()).success, true, `the ${name} never landed, so its tags are judged on nothing`);
      assert.deepEqual(cacheCalls, [
        { name: "updateTag", args: ["spiele"] },
        { name: "refresh", args: [] },
      ]);
    });
  }
});

describe("the settle's and the discard's refusals against the codes their endpoints publish", () => {
  for (const [operation, act] of [
    [EINTRAGEN, eintragen],
    [VERWERFEN, verwerfen],
  ] as const) {
    it(`answers every code ${operation} publishes through the slice's mapper`, async () => {
      await assertEachAnswered({ operation, refuseWith: client.answerWith, act, mapped: mapSpielbestaetigungAdminRefusal });
    });
  }

  // The row's own state, which a reload shows: the press cannot pass again, so neither sentence offers a retry.
  it("words each state refusal with the reload, never a retry", () => {
    assert.ok(publishedRefusals(EINTRAGEN).includes("REQ-ANSETZUNG-013"), "the settle no longer publishes its state refusal");
    assert.ok(publishedRefusals(VERWERFEN).includes("REQ-ANSETZUNG-014"), "the discard no longer publishes its state refusal");

    for (const [operation, code] of [
      [EINTRAGEN, "REQ-ANSETZUNG-013"],
      [VERWERFEN, "REQ-ANSETZUNG-014"],
    ] as const) {
      const shown = answerShown(operation, code, mapSpielbestaetigungAdminRefusal) as { error?: string } | null;
      assert.match(shown?.error ?? "", /Lade die Seite neu\.$/, `${code} offers a retry the same state refuses again`);
    }
  });
});
