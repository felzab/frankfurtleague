import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { parseDate } from "@internationalized/date";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { MEDIEN_MIN_ALTER } from "@/features/registrierungen/constants.ts";
import { laufendeKontaktSaisonFassung } from "@/shared/testing/einwilligungAnswers.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest";
import { assertOwnPanel } from "@/shared/testing/resultPanels.ts";
import { getGermanTodayStr } from "@/shared/utils/date.ts";

import { ABLEHNEN_LABEL, VERTRETUNG_MIN_ALTER } from "../../constants.ts";

import type { BestaetigungStart } from "./BestaetigungView.tsx";

const fetchMock = doubleFetch();

const { BestaetigungView } = await import("./BestaetigungView.tsx");
const { BestaetigungFormPanel } = await import("./BestaetigungFormPanel.tsx");

/** The season row's own page, which every link on a row opens unless the applicant named the person. */
const KONTAKT = laufendeKontaktSaisonFassung();

/** Every sentence a page about an application says and a season row's seat must not: nobody applied, nothing is deleted with an application. */
const NUR_BEWERBUNG = /Bewerbung|eingereicht|Wird Deine Schule neu eingetragen/;

const ANSICHT = {
  acknowledged: 1 as const,
  zustand: "gueltig" as const,
  quelle: "saison" as const,
  zeile: "offen" as const,
  saison_id: "2627",
  schule: "Lessing-Kolleg",
  rolle: "ansprechperson" as const,
  zugleich_rolle: "trainer" as const,
  vorname: "Mira",
  text_version: KONTAKT.textVersion,
  laufende_fassung: KONTAKT.textVersion,
  mindestalter: VERTRETUNG_MIN_ALTER,
  medien_mindestalter: MEDIEN_MIN_ALTER,
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

  /* The row is a team's, and the page's own stamped words and the mail call it so: „Schule“ is the
     application's word, for the school that applied. */
  it("names the team as a team in the banner, where an application's page names the school", () => {
    const offen = page({ zustand: "gueltig", ansicht: ANSICHT, token: "kein-echtes-token", fassung: KONTAKT });

    assert.match(offen, /Team\s*Lessing-Kolleg/);
    assert.doesNotMatch(offen, /Schule\s*Lessing-Kolleg/);
    // The control: the application's own page keeps its school.
    assert.match(
      page({ zustand: "gueltig", ansicht: { ...ANSICHT, quelle: "bewerbung" }, token: "kein-echtes-token", fassung: KONTAKT }),
      /Schule\s*Lessing-Kolleg/,
    );
  });

  for (const [sitze, zugleich, satz] of [
    ["one seat", null, /Dein Eintrag für das Team Lessing-Kolleg ist bestätigt\./],
    ["a paired seat", "trainer", /Deine beiden Einträge für das Team Lessing-Kolleg sind bestätigt\./],
  ] as const) {
    it(`thanks ${sitze} for confirming an entry for the team, never for a school`, async () => {
      fetchMock.mock.mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ success: true, ergebnis: "bestaetigt", geburtsdatum: "2000-01-01", whatsapp: false, medien: false }), {
            status: 200,
          }),
        ),
      );
      const user = userEvent.setup();
      const { container, unmount } = render(
        h(BestaetigungView, {
          start: { zustand: "gueltig", ansicht: { ...ANSICHT, zugleich_rolle: zugleich }, token: "kein-echtes-token", fassung: KONTAKT },
        }),
      );

      const [jahr = "", monat = "", tag = ""] = parseDate(getGermanTodayStr()).subtract({ years: 30 }).toString().split("-");
      await user.click(screen.getByRole("spinbutton", { name: /Tag/ }));
      await user.keyboard(`${tag}${monat}${jahr}`);
      await user.click(screen.getByRole("button", { name: "Eintrag bestätigen" }));
      await act(fetchMock.answered);

      const text = (container.textContent ?? "").replace(/\s+/g, " ");
      assert.match(text, satz);
      assertOwnPanel(container.innerHTML, satz, "erfolg");
      assert.doesNotMatch(text, /für die Schule/);
      unmount();
    });
  }

  /* The receipt reads the media consent in the words every confirmation page shares (`medienZeile`), so
     the contact page cannot drift to a wording of its own. */
  it("reads the stored media consent back in the receipt's shared row", async () => {
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: true, ergebnis: "bestaetigt", geburtsdatum: "2000-01-01", whatsapp: false, medien: false }), {
          status: 200,
        }),
      ),
    );
    const user = userEvent.setup();
    const { unmount } = render(
      h(BestaetigungView, { start: { zustand: "gueltig", ansicht: ANSICHT, token: "kein-echtes-token", fassung: KONTAKT } }),
    );

    const [jahr = "", monat = "", tag = ""] = parseDate(getGermanTodayStr()).subtract({ years: 30 }).toString().split("-");
    await user.click(screen.getByRole("spinbutton", { name: /Tag/ }));
    await user.keyboard(`${tag}${monat}${jahr}`);
    await user.click(screen.getByRole("button", { name: "Eintrag bestätigen" }));
    await act(fetchMock.answered);

    const zeile = screen.getByText("Fotos, Videos und Interviews");
    assert.equal(zeile.nextElementSibling?.textContent, "nicht erlaubt");
    unmount();
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
        medienMindestalter: MEDIEN_MIN_ALTER,
        onAbschluss: () => undefined,
      }),
    );

    await user.click(screen.getByRole("button", { name: ABLEHNEN_LABEL }));

    assert.ok(screen.queryByText(/Ohne Deine Bestätigung bleibt Dein Eintrag unbestätigt\./), "the armed objection warns of an application");
    assert.equal(screen.queryAllByText(/die Bewerbung nicht vollständig/).length, 0, "the armed objection warns of an application");
    unmount();
  });
});
