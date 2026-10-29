import { answerShown, DUPLICATE_KEY, refusalCodes, refused } from "@/test-support/refusals.ts";
import { describe, expect, it } from "vitest";

import {
  mapAntragAblehnungRefusal,
  mapAntragGenehmigungRefusal,
  mapEntziehenRefusal,
  mapErteilenRefusal,
  mapStufeRefusal,
} from "./refusals.ts";

const APPROVE = "POST /berechtigungen/antraege/{antrag_id}/genehmigung";
const REFUSE = "DELETE /berechtigungen/antraege/{antrag_id}";

/** A second request about an address, refused on the grant's box and on the promotion's toast alike. */
const ANTRAG_OFFEN = "Für diese Adresse wartet schon ein Antrag. Du findest ihn unter „Offene Anträge“.";

describe("the grant's refusals", () => {
  /* Both spellings of one grant: the rule refuses a second, and the unique index refuses it again where
     two administrators press together, so which answers is a race. */
  it("lands both spellings of an address already granted on the address box", () => {
    const onTheBox = { fieldErrors: { email: "Diese Adresse hat bereits Zugang zur Verwaltung." } };

    expect(mapErteilenRefusal(refused("REQ-BERECHTIGUNG-001", 409))).toStrictEqual(onTheBox);
    expect(mapErteilenRefusal(refused(DUPLICATE_KEY, 409))).toStrictEqual(onTheBox);
  });

  it("lands a barred address on the address box, with the ban to lift first", () => {
    expect(mapErteilenRefusal(refused("REQ-BERECHTIGUNG-003", 409))).toStrictEqual({
      fieldErrors: { email: "Diese Adresse ist gesperrt. Hebe zuerst die Sperre auf, wenn sie Zugang zur Verwaltung erhalten soll." },
    });
  });

  /* The box is no way out of this one: the request already waiting is decided first, so the sentence says where it is. */
  it("lands a second request about an address on the address box, naming where the first one waits", () => {
    expect(mapErteilenRefusal(refused("REQ-BERECHTIGUNG-008", 409))).toStrictEqual({ fieldErrors: { email: ANTRAG_OFFEN } });
    expect(mapStufeRefusal(refused("REQ-BERECHTIGUNG-008", 409))).toStrictEqual({ error: ANTRAG_OFFEN });
  });

  it("answers every refusal the grant publishes", () => {
    for (const code of refusalCodes("DB-COMMON-002", "REQ-BERECHTIGUNG-001", "REQ-BERECHTIGUNG-003", "REQ-BERECHTIGUNG-008")) {
      expect(answerShown(code, mapErteilenRefusal), `${code} reaches the admin as an unhandled refusal`).not.toBe(null);
    }
  });
});

describe("the revoke's refusals", () => {
  it("names each reason a revoke is refused in its own sentence", () => {
    expect(mapEntziehenRefusal(refused("REQ-BERECHTIGUNG-005", 403))).toStrictEqual({
      error:
        "Den Zugang entziehen können nur Inhaberinnen und Inhaber. Bist Du erst nach Deiner Anmeldung Inhaberin oder Inhaber geworden, melde Dich neu an.",
    });
    expect(mapEntziehenRefusal(refused("REQ-BERECHTIGUNG-002", 409))).toStrictEqual({
      error: "Einer Inhaberin oder einem Inhaber lässt sich der Zugang nicht entziehen. Stufe die Person zuerst zur Verwaltung herab.",
    });
    expect(mapEntziehenRefusal(refused("REQ-BERECHTIGUNG-004", 409))).toStrictEqual({
      error: "Die Verwaltung braucht mindestens zwei Personen mit Zugang. Füge zuerst eine weitere hinzu.",
    });
  });

  /* A grant another administrator has already revoked is a reload, which the shared reader words. */
  it("leaves a revoke of a grant already gone to the shared reader", () => {
    expect(mapEntziehenRefusal(refused("DB-COMMON-001", 404))).toBe(null);
  });

  it("answers every refusal the revoke publishes", () => {
    for (const code of refusalCodes("REQ-BERECHTIGUNG-002", "REQ-BERECHTIGUNG-004", "REQ-BERECHTIGUNG-005")) {
      expect(answerShown(code, mapEntziehenRefusal), `${code} reaches the admin as an unhandled refusal`).not.toBe(null);
    }
  });
});

describe("the tier change's refusals", () => {
  it("names each reason a tier change is refused in its own sentence", () => {
    expect(mapStufeRefusal(refused("REQ-BERECHTIGUNG-005", 403))).toStrictEqual({
      error:
        "Die Stufe eines Zugangs ändern können nur Inhaberinnen und Inhaber. Bist Du erst nach Deiner Anmeldung Inhaberin oder Inhaber geworden, melde Dich neu an.",
    });
    expect(mapStufeRefusal(refused("REQ-BERECHTIGUNG-003", 409))).toStrictEqual({
      error: "Diese Adresse ist gesperrt. Hebe zuerst die Sperre auf, wenn sie Inhaberin oder Inhaber werden soll.",
    });
    expect(mapStufeRefusal(refused("REQ-BERECHTIGUNG-007", 409))).toStrictEqual({
      error:
        "Die Verwaltung braucht mindestens eine Inhaberin oder einen Inhaber. Ernenne zuerst eine weitere Person zur Inhaberin oder zum Inhaber.",
    });
  });

  /* A grant revoked while the page stood is a reload, which the shared reader words. */
  it("leaves a tier change of a grant already gone to the shared reader", () => {
    expect(mapStufeRefusal(refused("DB-COMMON-001", 404))).toBe(null);
  });

  it("answers every refusal the tier change publishes", () => {
    for (const code of refusalCodes(
      "DB-COMMON-002",
      "REQ-BERECHTIGUNG-003",
      "REQ-BERECHTIGUNG-005",
      "REQ-BERECHTIGUNG-007",
      "REQ-BERECHTIGUNG-008",
    )) {
      expect(answerShown(code, mapStufeRefusal), `${code} reaches the admin as an unhandled refusal`).not.toBe(null);
    }
  });
});

describe("a request's decision refused", () => {
  /* Its requester withdraws a request, so on a refusal `-009` is the subject's alone: the approval's sentence names both. */
  it("tells the approval's own reader apart from the refusal's", () => {
    expect(mapAntragGenehmigungRefusal(refused("REQ-BERECHTIGUNG-009"))).toBe(
      "Einen Antrag, den Du gestellt hast oder der Dich betrifft, genehmigt eine andere Person aus der Verwaltung, eine Ernennung eine andere Inhaberin oder ein anderer Inhaber.",
    );
    expect(mapAntragAblehnungRefusal(refused("REQ-BERECHTIGUNG-009"))).toBe(
      "Über einen Antrag, der Dich betrifft, entscheidet eine andere Person aus der Verwaltung, über eine Ernennung eine andere Inhaberin oder ein anderer Inhaber.",
    );
  });

  /* The approval and the grant are one transaction, so a refused address leaves the request standing until it is refused. */
  it("names the refusal as the way out where the address has changed since the request", () => {
    expect(mapAntragGenehmigungRefusal(refused("REQ-BERECHTIGUNG-003"))).toBe(
      "Diese Adresse ist inzwischen gesperrt, deshalb ist nichts genehmigt. Lehne den Antrag ab, oder hebe zuerst die Sperre auf.",
    );
    expect(mapAntragGenehmigungRefusal(refused("REQ-BERECHTIGUNG-012"))).toBe(
      "Wer den Antrag gestellt hat, hat diesen Zugang inzwischen nicht mehr, deshalb genehmigt ihn niemand. Lehne ihn ab und stelle ihn bei Bedarf neu.",
    );
  });

  it("answers a request decided, withdrawn or lapsed since the page loaded with the reload", () => {
    const neuLaden = "Dieser Antrag ist nicht mehr offen. Lade die Seite neu.";

    expect(mapAntragGenehmigungRefusal(refused("DB-COMMON-001"))).toBe(neuLaden);
    expect(mapAntragAblehnungRefusal(refused("DB-COMMON-001"))).toBe(neuLaden);
  });

  for (const [operation, mapper, codes] of [
    [
      APPROVE,
      mapAntragGenehmigungRefusal,
      refusalCodes(
        "DB-COMMON-002",
        "REQ-BERECHTIGUNG-001",
        "REQ-BERECHTIGUNG-003",
        "REQ-BERECHTIGUNG-009",
        "REQ-BERECHTIGUNG-010",
        "REQ-BERECHTIGUNG-011",
        "REQ-BERECHTIGUNG-012",
      ),
    ],
    [REFUSE, mapAntragAblehnungRefusal, refusalCodes("REQ-BERECHTIGUNG-009", "REQ-BERECHTIGUNG-010", "REQ-BERECHTIGUNG-011")],
  ] as const) {
    it(`answers every refusal ${operation} publishes`, () => {
      for (const code of codes) {
        expect(answerShown(code, mapper), `${code} reaches the admin as an unhandled refusal`).not.toBe(null);
      }
    });
  }
});

describe("what neither mapper answers", () => {
  it("reads the code and never the status", () => {
    expect(mapErteilenRefusal(refused("REQ-BERECHTIGUNG-001", 422))).toStrictEqual(mapErteilenRefusal(refused("REQ-BERECHTIGUNG-001", 409)));
  });

  it("leaves an error that never came from the API alone", () => {
    expect(mapErteilenRefusal(new Error("the network went away"))).toBe(null);
    expect(mapEntziehenRefusal(null)).toBe(null);
    expect(mapStufeRefusal(undefined)).toBe(null);
  });
});
