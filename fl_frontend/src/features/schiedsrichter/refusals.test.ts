import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered } from "@/shared/testing/publishedRefusals.ts";

import { mapAnonymiseRefusal, mapGesperrteAdresseRefusal, mapNameRefusal, mapReactivateRefusal, mapRetireRefusal } from "./refusals.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* The real actions and their mutations, called: the request they run in and the backend client are the
   doubles. A file of its own, `actions.test.ts` replacing this slice's actions module for the components it renders. */
doubleActionRequest();
const { answerWith, calls } = doubleApiAnswers();
const {
  anonymiseSchiedsrichterAction,
  deleteSchiedsrichterAction,
  einladeSchiedsrichterAction,
  patchSchiedsrichterAction,
  postSchiedsrichterAction,
  reactivateSchiedsrichterAction,
} = await import("./actions.ts");

const ANONYMISE_OPERATION = "POST /schiedsrichter/{schiedsrichter_id}/anonymisieren";
const CREATE_OPERATION = "POST /schiedsrichter";
const SAVE_OPERATION = "PATCH /schiedsrichter/{schiedsrichter_id}";
const REACTIVATE_OPERATION = "POST /schiedsrichter/{schiedsrichter_id}/reactivate";
const RETIRE_OPERATION = "DELETE /schiedsrichter/{schiedsrichter_id}";

const SCHIEDSRICHTER_ID = "68c1f0a2b3c4d5e6f7a8b9c0";

/** A referee both write schemas take as they stand, so each write reaches the doubled request rather than the parse. */
const REFEREE = { name: "Anna Beispiel", default_payment: 25, kontakt: { email: "anna@example.de", telefon: "069 1234567" }, schule: null };

/**
 * Each write's answer as the backend sends it where the write landed. The two that mint a link fail
 * instead, so no message is composed: what the case reads is what each write sends.
 */
function landed({ endpoint, method }: ApiCall): Promise<unknown> {
  if (endpoint === "/schiedsrichter" || endpoint.endsWith("/einladen")) return Promise.reject(new Error("the mint is refused"));
  const stored = { id: SCHIEDSRICHTER_ID, ...REFEREE, inactive_since: null, geburtsdatum: null, einwilligung: null, bestaetigung: null };
  // The re-send reads the referee first, to mail the address the row holds.
  if (method === undefined) return Promise.resolve({ acknowledged: 1, schiedsrichter: stored });
  if (method === "PATCH") return Promise.resolve({ acknowledged: 1, updated_document: stored, fanned_out_to_spiele: 0, bestaetigung: null });
  if (endpoint.endsWith("/reactivate")) return Promise.resolve({ acknowledged: 1, updated_document: stored, bestaetigung: null });
  return Promise.resolve({ acknowledged: 1, updated_document: stored });
}

describe("the referee's writes", () => {
  it("reach each published path and method, the id in the path and the fields alone in the body", async () => {
    answerWith(landed);

    await postSchiedsrichterAction(REFEREE);
    await patchSchiedsrichterAction({ id: SCHIEDSRICHTER_ID, ...REFEREE });
    await deleteSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });
    await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });
    await anonymiseSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });
    await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    const referee = `/schiedsrichter/${SCHIEDSRICHTER_ID}`;
    assert.deepEqual(requestsOf(calls), [
      { endpoint: "/schiedsrichter", method: "POST", body: REFEREE },
      { endpoint: referee, method: "PATCH", body: REFEREE },
      { endpoint: referee, method: "DELETE", body: undefined },
      { endpoint: `${referee}/reactivate`, method: "POST", body: undefined },
      { endpoint: `${referee}/anonymisieren`, method: "POST", body: undefined },
      { endpoint: referee, method: undefined, body: undefined },
      { endpoint: `${referee}/bestaetigung/einladen`, method: "POST", body: undefined },
    ]);
  });
});

describe("what each referee write answers a refusal with", () => {
  /* Both writes meet the name's unique index and the ban list, and each refusal belongs on the box
     holding the value it refused: a write asking one mapper alone reports the other as a conflict. */
  it("answers the create's and the save's refusals on the name box and the address box", async () => {
    const saveAnswer = (refusal: unknown) => mapNameRefusal(refusal) ?? mapGesperrteAdresseRefusal(refusal);

    await assertEachAnswered({
      operation: CREATE_OPERATION,
      refuseWith: answerWith,
      act: () => postSchiedsrichterAction(REFEREE),
      mapped: saveAnswer,
    });
    await assertEachAnswered({
      operation: SAVE_OPERATION,
      refuseWith: answerWith,
      act: () => patchSchiedsrichterAction({ id: SCHIEDSRICHTER_ID, ...REFEREE }),
      mapped: saveAnswer,
    });
  });

  /* Each of the reversible pair and the erasure asks its own mapper: the retirement's refusal read out
     about an erasure, or the other way round, names a rule the admin did not meet. */
  it("answers the retirement's, the reactivation's and the erasure's refusals each with its own mapper", async () => {
    await assertEachAnswered({
      operation: RETIRE_OPERATION,
      refuseWith: answerWith,
      act: () => deleteSchiedsrichterAction({ id: SCHIEDSRICHTER_ID }),
      mapped: mapRetireRefusal,
    });
    await assertEachAnswered({
      operation: REACTIVATE_OPERATION,
      refuseWith: answerWith,
      act: () => reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID }),
      mapped: mapReactivateRefusal,
    });
    await assertEachAnswered({
      operation: ANONYMISE_OPERATION,
      refuseWith: answerWith,
      act: () => anonymiseSchiedsrichterAction({ id: SCHIEDSRICHTER_ID }),
      mapped: mapAnonymiseRefusal,
    });
  });
});
