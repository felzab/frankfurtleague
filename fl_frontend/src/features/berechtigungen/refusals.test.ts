import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { answerShown, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";

import {
  mapAntragAblehnungRefusal,
  mapAntragGenehmigungRefusal,
  mapEntziehenRefusal,
  mapErteilenRefusal,
  mapStufeRefusal,
} from "./refusals.ts";

const GRANT = "POST /berechtigungen";
const REVOKE = "DELETE /berechtigungen/{berechtigung_id}";
const TIER = "PATCH /berechtigungen/{berechtigung_id}";
const APPROVE = "POST /berechtigungen/antraege/{antrag_id}/genehmigung";
const REFUSE = "DELETE /berechtigungen/antraege/{antrag_id}";

/** A second request about an address, refused on the grant's box and on the promotion's toast alike. */
const ANTRAG_OFFEN = "Für diese Adresse wartet schon ein Antrag. Du findest ihn unter „Offene Anträge“.";

describe("the grant's refusals", () => {
  /* Both spellings of one grant: the rule refuses a second, and the unique index refuses it again where
     two administrators press together, so which answers is a race. */
  it("lands both spellings of an address already granted on the address box", () => {
    const onTheBox = { fieldErrors: { email: "Diese Adresse hat bereits Zugang zur Verwaltung." } };

    assert.deepEqual(mapErteilenRefusal(refusedOn(GRANT, "REQ-BERECHTIGUNG-001", 409)), onTheBox);
    assert.deepEqual(mapErteilenRefusal(refusedOn(GRANT, DUPLICATE_KEY, 409)), onTheBox);
  });

  it("lands a barred address on the address box, with the ban to lift first", () => {
    assert.deepEqual(mapErteilenRefusal(refusedOn(GRANT, "REQ-BERECHTIGUNG-003", 409)), {
      fieldErrors: { email: "Diese Adresse ist gesperrt. Hebe zuerst die Sperre auf, wenn sie Zugang zur Verwaltung erhalten soll." },
    });
  });

  /* The box is no way out of this one: the request already waiting is decided first, so the sentence says where it is. */
  it("lands a second request about an address on the address box, naming where the first one waits", () => {
    assert.deepEqual(mapErteilenRefusal(refusedOn(GRANT, "REQ-BERECHTIGUNG-008", 409)), { fieldErrors: { email: ANTRAG_OFFEN } });
    assert.deepEqual(mapStufeRefusal(refusedOn(TIER, "REQ-BERECHTIGUNG-008", 409)), { error: ANTRAG_OFFEN });
  });

  it("answers every refusal the grant publishes", () => {
    for (const code of publishedRefusals(GRANT)) {
      assert.notEqual(answerShown(GRANT, code, mapErteilenRefusal), null, `${code} reaches the admin as an unhandled refusal`);
    }
  });
});

describe("the revoke's refusals", () => {
  it("names each reason a revoke is refused in its own sentence", () => {
    assert.deepEqual(mapEntziehenRefusal(refusedOn(REVOKE, "REQ-BERECHTIGUNG-005", 403)), {
      error:
        "Den Zugang entziehen können nur Inhaberinnen und Inhaber. Bist Du erst nach Deiner Anmeldung Inhaberin oder Inhaber geworden, melde Dich neu an.",
    });
    assert.deepEqual(mapEntziehenRefusal(refusedOn(REVOKE, "REQ-BERECHTIGUNG-002", 409)), {
      error: "Einer Inhaberin oder einem Inhaber lässt sich der Zugang nicht entziehen. Stufe die Person zuerst zur Verwaltung herab.",
    });
    assert.deepEqual(mapEntziehenRefusal(refusedOn(REVOKE, "REQ-BERECHTIGUNG-004", 409)), {
      error: "Die Verwaltung braucht mindestens zwei Personen mit Zugang. Füge zuerst eine weitere hinzu.",
    });
  });

  /* A grant another administrator has already revoked is a reload, which the shared reader words. */
  it("leaves a revoke of a grant already gone to the shared reader", () => {
    assert.equal(mapEntziehenRefusal(refusedOn(REVOKE, "DB-COMMON-001", 404)), null);
  });

  it("answers every refusal the revoke publishes", () => {
    for (const code of publishedRefusals(REVOKE)) {
      assert.notEqual(answerShown(REVOKE, code, mapEntziehenRefusal), null, `${code} reaches the admin as an unhandled refusal`);
    }
  });
});

describe("the tier change's refusals", () => {
  it("names each reason a tier change is refused in its own sentence", () => {
    assert.deepEqual(mapStufeRefusal(refusedOn(TIER, "REQ-BERECHTIGUNG-005", 403)), {
      error:
        "Die Stufe eines Zugangs ändern können nur Inhaberinnen und Inhaber. Bist Du erst nach Deiner Anmeldung Inhaberin oder Inhaber geworden, melde Dich neu an.",
    });
    assert.deepEqual(mapStufeRefusal(refusedOn(TIER, "REQ-BERECHTIGUNG-003", 409)), {
      error: "Diese Adresse ist gesperrt. Hebe zuerst die Sperre auf, wenn sie Inhaberin oder Inhaber werden soll.",
    });
    assert.deepEqual(mapStufeRefusal(refusedOn(TIER, "REQ-BERECHTIGUNG-007", 409)), {
      error:
        "Die Verwaltung braucht mindestens eine Inhaberin oder einen Inhaber. Ernenne zuerst eine weitere Person zur Inhaberin oder zum Inhaber.",
    });
  });

  /* A grant revoked while the page stood is a reload, which the shared reader words. */
  it("leaves a tier change of a grant already gone to the shared reader", () => {
    assert.equal(mapStufeRefusal(refusedOn(TIER, "DB-COMMON-001", 404)), null);
  });

  it("answers every refusal the tier change publishes", () => {
    for (const code of publishedRefusals(TIER)) {
      assert.notEqual(answerShown(TIER, code, mapStufeRefusal), null, `${code} reaches the admin as an unhandled refusal`);
    }
  });
});

describe("a request's decision refused", () => {
  /* Its requester withdraws a request, so on a refusal `-009` is the subject's alone: the approval's sentence names both. */
  it("tells the approval's own reader apart from the refusal's", () => {
    assert.equal(
      mapAntragGenehmigungRefusal(refusedOn(APPROVE, "REQ-BERECHTIGUNG-009")),
      "Einen Antrag, den Du gestellt hast oder der Dich betrifft, genehmigt eine andere Person aus der Verwaltung, eine Ernennung eine andere Inhaberin oder ein anderer Inhaber.",
    );
    assert.equal(
      mapAntragAblehnungRefusal(refusedOn(REFUSE, "REQ-BERECHTIGUNG-009")),
      "Über einen Antrag, der Dich betrifft, entscheidet eine andere Person aus der Verwaltung, über eine Ernennung eine andere Inhaberin oder ein anderer Inhaber.",
    );
  });

  /* The approval and the grant are one transaction, so a refused address leaves the request standing until it is refused. */
  it("names the refusal as the way out where the address has changed since the request", () => {
    assert.equal(
      mapAntragGenehmigungRefusal(refusedOn(APPROVE, "REQ-BERECHTIGUNG-003")),
      "Diese Adresse ist inzwischen gesperrt, deshalb ist nichts genehmigt. Lehne den Antrag ab, oder hebe zuerst die Sperre auf.",
    );
    assert.equal(
      mapAntragGenehmigungRefusal(refusedOn(APPROVE, "REQ-BERECHTIGUNG-012")),
      "Wer den Antrag gestellt hat, hat diesen Zugang inzwischen nicht mehr, deshalb genehmigt ihn niemand. Lehne ihn ab und stelle ihn bei Bedarf neu.",
    );
  });

  it("answers a request decided, withdrawn or lapsed since the page loaded with the reload", () => {
    const neuLaden = "Dieser Antrag ist nicht mehr offen. Lade die Seite neu.";

    assert.equal(mapAntragGenehmigungRefusal(refusedOn(APPROVE, "DB-COMMON-001")), neuLaden);
    assert.equal(mapAntragAblehnungRefusal(refusedOn(REFUSE, "DB-COMMON-001")), neuLaden);
  });

  for (const [operation, mapper] of [
    [APPROVE, mapAntragGenehmigungRefusal],
    [REFUSE, mapAntragAblehnungRefusal],
  ] as const) {
    it(`answers every refusal ${operation} publishes`, () => {
      for (const code of publishedRefusals(operation)) {
        assert.notEqual(answerShown(operation, code, mapper), null, `${code} reaches the admin as an unhandled refusal`);
      }
    });
  }
});

describe("what neither mapper answers", () => {
  it("reads the code and never the status", () => {
    assert.deepEqual(
      mapErteilenRefusal(refusedOn(GRANT, "REQ-BERECHTIGUNG-001", 422)),
      mapErteilenRefusal(refusedOn(GRANT, "REQ-BERECHTIGUNG-001", 409)),
    );
  });

  it("leaves an error that never came from the API alone", () => {
    assert.equal(mapErteilenRefusal(new Error("the network went away")), null);
    assert.equal(mapEntziehenRefusal(null), null);
    assert.equal(mapStufeRefusal(undefined), null);
  });
});
