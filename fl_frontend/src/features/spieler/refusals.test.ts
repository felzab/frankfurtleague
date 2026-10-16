import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered, refusedOn } from "@/shared/testing/publishedRefusals.ts";

import { ADRESSE_AENDERN } from "./constants.ts";
import {
  KEINE_ADRESSE_HINTERLEGT,
  mapAdresswechselAntragRefusal,
  mapAdresswechselLinkRefusal,
  mapAlreadyInSaisonRefusal,
  mapSquadRefusal,
} from "./refusals.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* The real actions and their mutations, called: the request they run in and the backend client are the
   doubles. A file of its own, `actions.test.ts` replacing this slice's actions module for the components it renders. */
doubleActionRequest();
const { answerWith, calls } = doubleApiAnswers();
const { SPERRLISTE_ADRESSE_GESPERRT } = await import("@/features/sperrliste/constants.ts");
const {
  beantrageSpielerAdresswechselAction,
  deleteSaisonSpielerAction,
  deleteSpielerAction,
  einladeSpielerAdresswechselAction,
  patchSaisonSpielerAction,
  patchSpielerAction,
  postSaisonSpielerAction,
  reactivateSaisonSpielerAction,
  reactivateSpielerAction,
} = await import("./actions.ts");

const ENTRY_OPERATION = "POST /spieler/{spieler_id}/saisons";
const SQUAD_PATCH_OPERATION = "PATCH /spieler/{spieler_id}/saisons/{saison_id}";
const REACTIVATE_ROW_OPERATION = "POST /spieler/{spieler_id}/saisons/{saison_id}/reactivate";
const REQUEST_OPERATION = "POST /spieler/{spieler_id}/adresswechsel";
const RESEND_OPERATION = "POST /spieler/{spieler_id}/adresswechsel/einladen";

const KEY = { spieler_id: "68c1f0a2b3c4d5e6f7a8b9c0", saison_id: "2026" };

/** A squad row the schemas take as it stands, every optional field cleared. */
const ROW = { ...KEY, team_id: "6890a1b2c3d4e5f607182932", nummer: null, position: null, stufe: null, rolle: null };

/** Each write's answer as the backend sends it where the write landed. */
function landed({ endpoint }: ApiCall): Record<string, unknown> {
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
      { endpoint: `${personPath}/saisons`, method: "POST", body: { saison_id: KEY.saison_id, ...squad } },
      { endpoint: rowPath, method: "PATCH", body: squad },
      { endpoint: rowPath, method: "DELETE", body: undefined },
      { endpoint: `${rowPath}/reactivate`, method: "POST", body: undefined },
    ]);
  });
});

describe("what each squad write answers a refusal with", () => {
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
});

describe("what each address write answers a refusal with", () => {
  it("answers the request's refusals with the request's own mapper", async () => {
    await assertEachAnswered({
      operation: REQUEST_OPERATION,
      refuseWith: answerWith,
      act: () => beantrageSpielerAdresswechselAction({ id: KEY.spieler_id, email: "lena@neu.example" }),
      mapped: mapAdresswechselAntragRefusal,
    });
  });

  it("answers the re-send's refusals with the pending change's mapper", async () => {
    await assertEachAnswered({
      operation: RESEND_OPERATION,
      refuseWith: answerWith,
      act: () => einladeSpielerAdresswechselAction({ id: KEY.spieler_id }),
      mapped: mapAdresswechselLinkRefusal,
    });
  });

  /* The address's own refusals land on the box holding it, which is itself the way out; the ban's
     sentence is the ban list's, for the administrator who keeps the list. */
  for (const [code, satz] of [
    ["REQ-SPIELER-003", SPERRLISTE_ADRESSE_GESPERRT],
    ["REQ-SPIELER-006", "Diese Adresse ist schon bei einer anderen Spielerin oder einem anderen Spieler hinterlegt."],
    ["REQ-SPIELER-007", "Das ist schon die hinterlegte Adresse."],
  ] as const) {
    it(`lands the request's ${code} on the address box`, () => {
      assert.deepEqual(mapAdresswechselAntragRefusal(refusedOn(REQUEST_OPERATION, code)), { error: satz, fieldErrors: { email: satz } });
    });
  }

  /* The waiting change's panel has no box, so its refusal sends the administrator to the press that opens one, by that press's label. */
  it("names the address box's own press where a pending address is taken", () => {
    assert.match(mapAdresswechselLinkRefusal(refusedOn(RESEND_OPERATION, "REQ-SPIELER-006")) ?? "", new RegExp(`„${ADRESSE_AENDERN}“`));
  });

  /* No box stands for a pupil holding no address, so only a stale page meets this. */
  it("lands the request's REQ-SPIELER-008 on no box", () => {
    assert.deepEqual(mapAdresswechselAntragRefusal(refusedOn(REQUEST_OPERATION, "REQ-SPIELER-008")), { error: KEINE_ADRESSE_HINTERLEGT });
  });
});
