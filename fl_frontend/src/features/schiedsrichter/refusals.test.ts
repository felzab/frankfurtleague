import { describe, it } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered } from "@/shared/testing/publishedRefusals.ts";

import { mapAnonymiseRefusal, mapGesperrteAdresseRefusal, mapNameRefusal, mapReactivateRefusal, mapRetireRefusal } from "./refusals.ts";

/* The real actions and their mutations, called: the request they run in and the backend client are the
   doubles. A file of its own, `actions.test.ts` replacing this slice's actions module for the components it renders. */
doubleActionRequest();
const { answerWith } = doubleApiAnswers();
const {
  anonymiseSchiedsrichterAction,
  deleteSchiedsrichterAction,
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
