import { refusalCodes, refused } from "@/test-support/refusals.ts";
import { assert, describe, expect, it } from "vitest";

import { ERASED_ACTOR_MARKER } from "@/core/erasedActor.ts";
import { mapVerwaltungAnsichtRefusal, mapVerwaltungLinkRefusal, mapVerwaltungStartRefusal } from "@/features/adresswechsel/refusals.ts";
import {
  GELOESCHTE_PERSON,
  GESPERRTE_ADRESSE,
  INHABER_GESPERRT,
  INHABER_LABEL,
  NACH_ERNENNUNG_NEU_ANMELDEN,
  NUR_INHABER_ENTZIEHT,
  STUFE_GEAENDERT_MESSAGE,
  stufeWorte,
  vonOderGesperrt,
} from "@/features/berechtigungen/constants.ts";
import { mapEntziehenRefusal, mapStufeRefusal } from "@/features/berechtigungen/refusals.ts";
import { mapAbmeldungRefusal, mapErasureRefusal } from "@/features/funktionen/refusals.ts";

import type { Code } from "@/core/generated/client/types.ts";

describe("the actor an admin card names", () => {
  it("names an administrator by their address", () => {
    expect(vonOderGesperrt("vorstand@schule.de", false)).toBe("vorstand@schule.de");
  });

  it("names a withheld administrator by their state", () => {
    expect(vonOderGesperrt(null, true)).toBe(GESPERRTE_ADRESSE);
  });

  // The backend never sends one half of the pair without the other; a card meeting it names no address
  // the flag says is barred, and never leaves the line empty.
  it("reads either half of the withheld pair alone as withheld", () => {
    expect(vonOderGesperrt("vorstand@schule.de", true)).toBe(GESPERRTE_ADRESSE);
    expect(vonOderGesperrt(null, false)).toBe(GESPERRTE_ADRESSE);
  });

  // The marker names nobody, so printed as it is served it would read as an address; and the person is
  // erased rather than barred.
  it("names an erased administrator by that state, never the marker and never as barred", () => {
    expect(vonOderGesperrt(ERASED_ACTOR_MARKER, false)).toBe(GELOESCHTE_PERSON);
  });
});

/** Whether every masculine form of the `owner` tier stands right after its feminine one, as in „Inhaberin oder Inhaber“. */
function inBeidenFormen(text: string): boolean {
  const formen = [...text.matchAll(/Inhaber(?:in(?:nen)?|n)?\b/g)].map(([form]) => form);

  return formen.every((form, index) => form.startsWith("Inhaberin") || (formen[index - 1]?.startsWith("Inhaberin") ?? false));
}

describe("the words the grants page names the owner tier in", () => {
  /* People of either gender hold the tier, and the notice the same change mails names it in both forms. */
  it("never name the tier by the masculine word alone, on a badge, a control, a consequence, an answer or a refusal", () => {
    const stufen = [true, false].flatMap((eigene) =>
      (["owner", "administration"] as const).flatMap((ziel) =>
        ["a@schule.de", null].map((adresse) => stufeWorte({ adresse: adresse, erteiltAm: "27.09.2026", ziel: ziel, eigene: eigene })),
      ),
    );
    const refusals = [
      ...refusalCodes("berechtigung_inhaber", "berechtigung_mindestzahl", "berechtigung_nur_inhaber").map((code) =>
        mapEntziehenRefusal(refused(code)),
      ),
      ...refusalCodes(
        "duplicate_key",
        "berechtigung_gesperrt",
        "berechtigung_nur_inhaber",
        "berechtigung_letzter_inhaber",
        "berechtigung_antrag_offen",
      ).map((code) => mapStufeRefusal(refused(code))),
    ];
    const worte = [
      INHABER_LABEL,
      NUR_INHABER_ENTZIEHT,
      INHABER_GESPERRT,
      ...Object.values(STUFE_GEAENDERT_MESSAGE),
      ...stufen.flatMap((stufe) => [stufe.resting, stufe.name ?? "", stufe.armed, stufe.running, stufe.folge]),
      ...refusals.map((refusal) => refusal?.error ?? ""),
    ];

    // The floor: a sweep reaching no word naming the tier passes over nothing.
    assert.ok(worte.filter((wort) => wort.includes("Inhaber")).length >= 10, "too few words name the tier to judge");
    expect(worte.filter((wort) => !inBeidenFormen(wort))).toStrictEqual([]);
  });

  it("reads a masculine form alone as one, and each pair the page writes as both", () => {
    expect(inBeidenFormen("Den Zugang entziehen kann nur der Inhaber.")).toBe(false);
    expect(inBeidenFormen("Inhaberin oder Inhaber wirst Du, wenn Dich ein anderer Inhaber ernennt.")).toBe(false);
    for (const paar of [
      "Inhaberin oder Inhaber",
      "Inhaberinnen und Inhaber",
      "zur Inhaberin oder zum Inhaber",
      "einer Inhaberin oder einem Inhaber",
    ]) {
      expect(inBeidenFormen(paar), paar).toBe(true);
    }
  });
});

describe("a refusal of an owner's power", () => {
  /** A mapper answering its sentence alone, read in the shape the others answer. */
  const alsFehler =
    (map: (error: unknown) => string | null) =>
    (error: unknown): { error?: string } | null => {
      const satz = map(error);
      return satz === null ? null : { error: satz };
    };

  /**
   * Each mapper of an operation refusing a session without an owner's power, an owner's signed in before the
   * promotion among them, with the code its service raises for it.
   */
  const WORDED_BY = [
    [mapErasureRefusal, "verwaltung_adresse"],
    [mapAbmeldungRefusal, "verwaltung_adresse"],
    [mapEntziehenRefusal, "berechtigung_nur_inhaber"],
    [mapStufeRefusal, "berechtigung_nur_inhaber"],
    [alsFehler(mapVerwaltungAnsichtRefusal), "verwaltung_adresse"],
    [mapVerwaltungStartRefusal, "verwaltung_adresse"],
    [alsFehler(mapVerwaltungLinkRefusal), "verwaltung_adresse"],
  ] as const satisfies readonly (readonly [(error: unknown) => { error?: string } | null, Code])[];

  /* An owner whose session predates the promotion is refused in the code an administrator is, and reads the sentence
     as false of them: only the closing sentence names the sign-in that repairs it. */
  it("sends an owner promoted since signing in to sign in again, on every operation refusing one", () => {
    for (const [mapper, code] of WORDED_BY) {
      const satz = mapper(refused(code))?.error ?? "";
      assert.ok(satz.endsWith(`. ${NACH_ERNENNUNG_NEU_ANMELDEN}`), `${mapper.name} answers ${code} as „${satz}“`);
    }
  });
});
