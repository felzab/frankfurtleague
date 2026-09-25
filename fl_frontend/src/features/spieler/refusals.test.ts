import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered } from "@/shared/testing/publishedRefusals.ts";

import { mapAlreadyInSaisonRefusal, mapErasureRefusal, mapSquadRefusal } from "./refusals.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* The real actions and their mutations, called: the request they run in and the backend client are the
   doubles. A file of its own, `actions.test.ts` replacing this slice's actions module for the components it renders. */
doubleActionRequest();
const { answerWith, calls } = doubleApiAnswers();
const {
  deleteSaisonSpielerAction,
  deleteSpielerAction,
  eraseSpielerAction,
  patchSaisonSpielerAction,
  patchSpielerAction,
  postSaisonSpielerAction,
  reactivateSaisonSpielerAction,
  reactivateSpielerAction,
} = await import("./actions.ts");

const ERASURE_OPERATION = "DELETE /spieler/{spieler_id}/erasure";
const ENTRY_OPERATION = "POST /spieler/{spieler_id}/saisons";
const SQUAD_PATCH_OPERATION = "PATCH /spieler/{spieler_id}/saisons/{saison_id}";
const REACTIVATE_ROW_OPERATION = "POST /spieler/{spieler_id}/saisons/{saison_id}/reactivate";
const RETIRE_ROW_OPERATION = "DELETE /spieler/{spieler_id}/saisons/{saison_id}";

const KEY = { spieler_id: "68c1f0a2b3c4d5e6f7a8b9c0", saison_id: "2026" };

/** A squad row the schemas take as it stands, every optional field cleared. */
const ROW = { ...KEY, team_id: "6890a1b2c3d4e5f607182932", nummer: null, position: null, stufe: null, rolle: null };

/** Each write's answer as the backend sends it where the write landed. */
function landed({ endpoint }: ApiCall): Record<string, unknown> {
  if (endpoint.endsWith("/erasure")) return { acknowledged: 1, spieler_id: KEY.spieler_id, erased_saison_spieler: 1, redacted_aktionen: 2 };
  if (endpoint.includes("/saisons")) return { acknowledged: 1, ...ROW, ist_nachnominiert: false, inactive_since: null };
  return { acknowledged: 1, spieler_id: KEY.spieler_id, vorname: "Lena", nachname: null, inactive_since: null };
}

describe("the player's writes", () => {
  it("reach each published path and method, the ids in the path and the fields alone in the body", async () => {
    answerWith((call) => Promise.resolve(landed(call)));
    const person = { vorname: "Lena", nachname: "Meier", geburtsdatum: null };
    const squad = { team_id: ROW.team_id, nummer: "7", position: null, stufe: null, rolle: null };

    await patchSpielerAction({ id: KEY.spieler_id, ...person });
    await deleteSpielerAction({ id: KEY.spieler_id });
    await reactivateSpielerAction({ id: KEY.spieler_id });
    await eraseSpielerAction({ id: KEY.spieler_id });
    await postSaisonSpielerAction({ ...KEY, ...squad });
    await patchSaisonSpielerAction({ ...KEY, ...squad });
    await deleteSaisonSpielerAction(KEY);
    await reactivateSaisonSpielerAction(KEY);

    const personPath = `/spieler/${KEY.spieler_id}`;
    const rowPath = `${personPath}/saisons/${KEY.saison_id}`;
    assert.deepEqual(requestsOf(calls), [
      { endpoint: personPath, method: "PATCH", body: person },
      { endpoint: personPath, method: "DELETE", body: undefined },
      { endpoint: `${personPath}/reactivate`, method: "POST", body: undefined },
      { endpoint: `${personPath}/erasure`, method: "DELETE", body: undefined },
      { endpoint: `${personPath}/saisons`, method: "POST", body: { saison_id: KEY.saison_id, ...squad } },
      { endpoint: rowPath, method: "PATCH", body: squad },
      { endpoint: rowPath, method: "DELETE", body: undefined },
      { endpoint: `${rowPath}/reactivate`, method: "POST", body: undefined },
    ]);
  });
});

describe("what each squad write answers a refusal with", () => {
  /* The squad mapper answers the same 409 status. Asked by the erasure, a squad code would be reported
     about a person nobody was entering. */
  it("answers the erasure's refusals with the erasure's own mapper", async () => {
    await assertEachAnswered({
      operation: ERASURE_OPERATION,
      refuseWith: answerWith,
      act: () => eraseSpielerAction({ id: KEY.spieler_id }),
      mapped: mapErasureRefusal,
    });
  });

  /* The squad's rules first and the junction's unique index after, so a repeat row — which the index
     finds among retired ones too — is the sentence left once the rules are ruled out. */
  it("answers the entry's refusals, the squad's rules before the unique index", async () => {
    await assertEachAnswered({
      operation: ENTRY_OPERATION,
      refuseWith: answerWith,
      act: () => postSaisonSpielerAction(ROW),
      mapped: (refusal) => mapSquadRefusal(refusal) ?? mapAlreadyInSaisonRefusal(refusal),
    });
  });

  /* The row's reactivation is a button with no form behind it, so the sentence beside a field message
     is the whole of what its toast can say. */
  it("answers the squad patch's and the row reactivation's refusals with the squad mapper", async () => {
    await assertEachAnswered({
      operation: SQUAD_PATCH_OPERATION,
      refuseWith: answerWith,
      act: () => patchSaisonSpielerAction(ROW),
      mapped: mapSquadRefusal,
    });
    await assertEachAnswered({
      operation: REACTIVATE_ROW_OPERATION,
      refuseWith: answerWith,
      act: () => reactivateSaisonSpielerAction(KEY),
      mapped: mapSquadRefusal,
    });
  });

  it("leaves the row retirement's refusals to the shared reader", async () => {
    await assertEachAnswered({
      operation: RETIRE_ROW_OPERATION,
      refuseWith: answerWith,
      act: () => deleteSaisonSpielerAction(KEY),
      mapped: () => null,
    });
  });
});
