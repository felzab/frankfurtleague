import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { laufendeKontaktFassung } from "@/shared/testing/einwilligungAnswers.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest";

import { ABLEHNEN_LABEL, VERTRETUNG_MIN_ALTER } from "../../constants.ts";

import type { BestaetigungStart } from "./BestaetigungView.tsx";

const { BestaetigungView } = await import("./BestaetigungView.tsx");
const { BestaetigungFormPanel } = await import("./BestaetigungFormPanel.tsx");

const KONTAKT = laufendeKontaktFassung();

/** Every sentence a page about an application says and a season row's seat must not: nobody applied, nothing is deleted with an application. */
const NUR_BEWERBUNG = /Bewerbung|eingereicht|Wird Deine Schule neu eingetragen/;

const ANSICHT = {
  acknowledged: 1 as const,
  zustand: "gueltig" as const,
  quelle: "saison" as const,
  saison_id: "2627",
  schule: "Lessing-Kolleg",
  rolle: "ansprechperson" as const,
  zugleich_rolle: "trainer" as const,
  vorname: "Mira",
  text_version: KONTAKT.textVersion,
  mindestalter: VERTRETUNG_MIN_ALTER,
};

const page = (start: BestaetigungStart): string => textOf(renderMarkup(BestaetigungView, { start }));

/* A person an administrator seated on a team's season row never applied: every panel the link can land
   them on says what is true of a season row, and the application's sentences stay the application's. */
describe("the confirmation page for a seat on a team's season row", () => {
  it("names a spent or dead season link's remedy as the administration's new link, never an application's deletion", () => {
    const tot = page({ zustand: "abgelaufen", quelle: "saison" });

    assert.match(tot, /Einen neuen Link schickt Dir die Verwaltung der Liga auf Wunsch\./);
    assert.doesNotMatch(tot, NUR_BEWERBUNG);
    // The control: an application's dead link keeps the application's two sentences.
    assert.match(page({ zustand: "abgelaufen", quelle: "bewerbung" }), /Eine Bewerbung, die bis dahin nicht alle Bestätigungen hat/);
    assert.match(page({ zustand: "ungueltig" }), /Wird Deine Schule neu eingetragen/);
  });

  it("says an earlier Widerspruch emptied the entry, never an application", () => {
    const widersprochen = page({ zustand: "abgelehnt", quelle: "saison" });

    assert.match(widersprochen, /Die Angaben sind aus dem Eintrag entfernt/);
    assert.doesNotMatch(widersprochen, NUR_BEWERBUNG);
  });

  it("asks a paired seat once without calling the entry an application", () => {
    const offen = page({ zustand: "gueltig", ansicht: ANSICHT, token: "kein-echtes-token", fassung: KONTAKT });

    assert.match(offen, /Du bist für dieses Team zweimal eingetragen/);
    assert.doesNotMatch(offen, /in dieser Bewerbung/);
  });

  /* The objection's own warning, under the armed press: no application waits on this seat to complete. */
  it("warns of the objection without an application to leave incomplete", async () => {
    const user = userEvent.setup();
    const { unmount } = render(
      h(BestaetigungFormPanel, {
        fassung: KONTAKT,
        token: "kein-echtes-token",
        vorname: "Mira",
        schule: "Lessing-Kolleg",
        saison: "2627",
        rolle: "Ansprechperson",
        istSaison: true,
        mindestalter: VERTRETUNG_MIN_ALTER,
        onAbschluss: () => undefined,
      }),
    );

    await user.click(screen.getByRole("button", { name: ABLEHNEN_LABEL }));

    assert.ok(screen.queryByText(/Ohne Deine Bestätigung bleibt Dein Eintrag unbestätigt\./), "the armed objection warns of an application");
    assert.equal(screen.queryAllByText(/die Bewerbung nicht vollständig/).length, 0, "the armed objection warns of an application");
    unmount();
  });
});
