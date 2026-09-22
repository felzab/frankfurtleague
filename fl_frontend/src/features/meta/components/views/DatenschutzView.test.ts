import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { VERTRETUNG_MIN_ALTER } from "@/features/bewerbungen/constants.ts";
import { REGISTRIERUNG_MIN_ALTER } from "@/features/registrierungen/constants.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest";

const { DatenschutzView } = await import("./DatenschutzView.tsx");

const MARKUP = renderMarkup(DatenschutzView, {});

const worte = (html: string): string => textOf(html, " ").replace(/\s+/g, " ").trim();

/** Every paragraph and list item the notice renders, so a claim is pinned as the whole run a reader meets. */
const ABSAETZE = [...MARKUP.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((element) => worte(element[2] ?? ""));

/** The label-and-value pairs of both `<dl>` lists, the retention table among them, keyed by the label. */
const ANGABEN = new Map(
  [...MARKUP.matchAll(/<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/g)].map((pair) => [
    worte(pair[1] ?? ""),
    worte(pair[2] ?? ""),
  ]),
);

const rendert = (absatz: string): void => assert.ok(ABSAETZE.includes(absatz), `no paragraph of the notice reads:\n  ${absatz}`);

describe("the privacy notice's account of a birthdate", () => {
  it("says the birthdate is compulsory and what it is checked against", () => {
    rendert(
      "Wer sich über den Link eines Teams registriert oder einen Eintrag als Schiedsrichterin oder Schiedsrichter bestätigt, trägt dabei " +
        "das eigene Geburtsdatum ein. Die Angabe ist Pflicht und wird nicht veröffentlicht: Mitspielen und Pfeifen kann nur, wer mindestens " +
        `${String(REGISTRIERUNG_MIN_ALTER)} Jahre alt ist, und das prüfen wir an diesem Datum. Bei Spielerinnen und Spielern, die schon vor ` +
        "der Registrierung im Kader standen, kann die Verwaltung das Geburtsdatum nachtragen.",
    );
  });

  /* Three floors behind one „16“, and no German sentence names three without repeating one: the
     merge is deliberate, and it becomes a lie the day any of them moves. */
  it("carries one age floor for playing, refereeing and standing as a contact person", () => {
    rendert(
      `Mitspielen, Pfeifen und Kontaktperson einer Bewerbung sein kann nur, wer mindestens ${String(REGISTRIERUNG_MIN_ALTER)} Jahre alt ` +
        `ist; als Ansprechperson oder Stellvertretung mindestens ${String(VERTRETUNG_MIN_ALTER)}.`,
    );
  });
});

describe("the privacy notice's retention table", () => {
  /* Nothing deletes an invite row, so the cell promises the link's end and never the entry's: a
     retention promise no sweep performs is one a reader can hold us to. */
  it("says a team's registration link expires while its entry stays", () => {
    assert.equal(
      ANGABEN.get(
        "Registrierungslink eines Teams: der Link als unlesbarer Schlüssel, dazu das Datum und die anlegende Person aus der Verwaltung",
      ),
      "Kein eigener Zeitraum: Der Link endet mit der Registrierungsfrist der Saison, für die er gilt, oder sobald die Verwaltung ihn " +
        "zurückzieht oder durch einen neuen ersetzt. Der Eintrag dazu nennt keine Person und enthält den Link nur als unlesbaren " +
        "Schlüssel; er bleibt bestehen.",
    );
  });

  it("gives a pupil's registration three fates, one per decision", () => {
    assert.equal(
      ANGABEN.get("Registrierung eines Spielers oder einer Spielerin"),
      "7 Tage ab dem Versand des Bestätigungslinks, wenn die Registrierung nicht bestätigt wird, dann Löschung; eine Erinnerung " +
        "verschiebt diese Frist nicht. Bestätigte Registrierungen behalten wir, bis in der nächsten Saison die Registrierung geschlossen " +
        "ist, und löschen sie dann, sofern nicht dieselbe E-Mail-Adresse sich dort wieder registriert hat. Eine abgelehnte Registrierung " +
        "löschen wir einen Monat nach der Entscheidung",
    );
  });
});
