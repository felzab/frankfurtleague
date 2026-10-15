import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ERASED_ACTOR_MARKER } from "@/core/erasedActor.ts";
import {
  GELOESCHTE_PERSON,
  GESPERRTE_ADRESSE,
  INHABER_GESPERRT,
  INHABER_LABEL,
  NUR_INHABER_ENTZIEHT,
  STUFE_GEAENDERT_MESSAGE,
  stufeWorte,
  vonOderGesperrt,
} from "@/features/berechtigungen/constants.ts";
import { mapEntziehenRefusal, mapStufeRefusal } from "@/features/berechtigungen/refusals.ts";
import { publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";

describe("the actor an admin card names", () => {
  it("names an administrator by their address", () => {
    assert.equal(vonOderGesperrt("vorstand@schule.de", false), "vorstand@schule.de");
  });

  it("names a withheld administrator by their state", () => {
    assert.equal(vonOderGesperrt(null, true), GESPERRTE_ADRESSE);
  });

  // The backend never sends one half of the pair without the other; a card meeting it names no address
  // the flag says is barred, and never leaves the line empty.
  it("reads either half of the withheld pair alone as withheld", () => {
    assert.equal(vonOderGesperrt("vorstand@schule.de", true), GESPERRTE_ADRESSE);
    assert.equal(vonOderGesperrt(null, false), GESPERRTE_ADRESSE);
  });

  // The marker names nobody, so printed as it is served it would read as an address; and the person is
  // erased rather than barred.
  it("names an erased administrator by that state, never the marker and never as barred", () => {
    assert.equal(vonOderGesperrt(ERASED_ACTOR_MARKER, false), GELOESCHTE_PERSON);
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
      ...publishedRefusals("DELETE /berechtigungen/{berechtigung_id}").map((code) =>
        mapEntziehenRefusal(refusedOn("DELETE /berechtigungen/{berechtigung_id}", code)),
      ),
      ...publishedRefusals("PATCH /berechtigungen/{berechtigung_id}").map((code) =>
        mapStufeRefusal(refusedOn("PATCH /berechtigungen/{berechtigung_id}", code)),
      ),
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
    assert.deepEqual(
      worte.filter((wort) => !inBeidenFormen(wort)),
      [],
    );
  });

  it("reads a masculine form alone as one, and each pair the page writes as both", () => {
    assert.equal(inBeidenFormen("Den Zugang entziehen kann nur der Inhaber."), false);
    assert.equal(inBeidenFormen("Inhaberin oder Inhaber wirst Du, wenn Dich ein anderer Inhaber ernennt."), false);
    for (const paar of [
      "Inhaberin oder Inhaber",
      "Inhaberinnen und Inhaber",
      "zur Inhaberin oder zum Inhaber",
      "einer Inhaberin oder einem Inhaber",
    ]) {
      assert.equal(inBeidenFormen(paar), true, paar);
    }
  });
});
