import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { parseDate } from "@internationalized/date";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { laufendeKontaktFassung } from "@/shared/testing/einwilligungAnswers.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";
import { getGermanTodayStr } from "@/shared/utils/date.ts";

import { ABLEHNEN_LABEL, BEWERBUNG_MIN_ALTER } from "../../constants.ts";

const fetchMock = doubleFetch();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { BestaetigungFormPanel } = await import("./BestaetigungFormPanel.tsx");
const { BestaetigungView } = await import("./BestaetigungView.tsx");

const KONTAKT = laufendeKontaktFassung();
/** Typed rather than taken from a constant: the page offers the switch from the age the link's read serves. */
const MEDIEN_ALTER = 18;

/** A birthdate this many whole years before the German day the page judges by, moved later by `tageSpaeter`. */
const geborenVor = (jahre: number, tageSpaeter = 0): string =>
  parseDate(getGermanTodayStr()).subtract({ years: jahre }).add({ days: tageSpaeter }).toString();

/** Types a date into the picker as its segments take it: day, month, year. */
async function tippeGeburtsdatum(user: ReturnType<typeof userEvent.setup>, datum: string): Promise<void> {
  const [jahr = "", monat = "", tag = ""] = datum.split("-");
  await user.click(screen.getByRole("spinbutton", { name: /Tag/ }));
  await user.keyboard(`${tag}${monat}${jahr}`);
}

/** The panel at the league's own floor, so a person below the media age can still confirm. */
const renderPanel = () =>
  render(
    h(BestaetigungFormPanel, {
      fassung: KONTAKT,
      token: "kein-echtes-token",
      vorname: "Mira",
      schule: "Lessing-Kolleg",
      saison: "2026",
      rolle: "Trainer",
      mindestalter: BEWERBUNG_MIN_ALTER,
      medienMindestalter: MEDIEN_ALTER,
      onAbschluss: () => undefined,
    }),
  );

/** The route handler's answer to every request of the case, each body recorded as it was sent. */
function answerEveryFetch(medien = false): { sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  fetchMock.mock.mockImplementation((_input, init) => {
    sent.push(JSON.parse(typeof init?.body === "string" ? init.body : "null") as Record<string, unknown>);

    return Promise.resolve(
      new Response(JSON.stringify({ success: true, ergebnis: "bestaetigt", geburtsdatum: "2000-01-01", whatsapp: false, medien: medien }), {
        status: 200,
      }),
    );
  });

  return { sent: sent };
}

// Every absence is asserted as a boolean: a failing `assert.equal` on a rendered node hands the runner
// React's whole tree to serialize, which exhausts the machine's memory.
const keinSchalter = (): boolean => screen.queryByRole("switch", { name: KONTAKT.bedienelemente.medien }) === null;

describe("the media switch, offered from the media age alone", () => {
  it("offers no switch while no birthdate says how old the person is", () => {
    renderPanel();

    assert.ok(keinSchalter(), "a person of unknown age is offered a consent the write refuses below the media age");
  });

  it("offers no switch for a date a day short of the media age", async () => {
    renderPanel();
    await tippeGeburtsdatum(userEvent.setup(), geborenVor(MEDIEN_ALTER, 1));

    assert.ok(keinSchalter(), "a person under the media age is offered the media switch");
  });

  it("offers the switch for a date of the media age to the day, off on first paint, and sends its yes", async () => {
    const { sent } = answerEveryFetch();
    const user = userEvent.setup();
    renderPanel();

    await tippeGeburtsdatum(user, geborenVor(MEDIEN_ALTER));
    assert.ok(!keinSchalter(), "a person of the media age is refused the switch");
    assert.equal(
      (screen.getByRole("switch", { name: KONTAKT.bedienelemente.medien }) as HTMLInputElement).checked,
      false,
      "the switch rests on a consent nobody gave",
    );

    await user.click(screen.getByRole("switch", { name: KONTAKT.bedienelemente.medien }));
    await user.click(screen.getByRole("button", { name: "Eintrag bestätigen" }));
    await act(fetchMock.answered);

    assert.equal(sent.length, 1, "the press sent nothing, so this case compares nothing");
    assert.equal(sent[0]?.medien, true, "the yes given on the switch was not sent");
  });

  /* What the press stored, off the echo rather than the draft: the page claims nothing the backend did not keep. */
  it("names the media consent the echo stored on the panel the press ends on", async () => {
    answerEveryFetch(true);
    const user = userEvent.setup();
    render(
      h(BestaetigungView, {
        start: {
          zustand: "gueltig",
          token: "kein-echtes-token",
          fassung: KONTAKT,
          ansicht: {
            acknowledged: 1,
            zustand: "gueltig",
            quelle: "bewerbung",
            zeile: null,
            saison_id: "2026",
            schule: "Lessing-Kolleg",
            rolle: "trainer",
            zugleich_rolle: null,
            vorname: "Mira",
            text_version: KONTAKT.textVersion,
            laufende_fassung: KONTAKT.textVersion,
            mindestalter: BEWERBUNG_MIN_ALTER,
            medien_mindestalter: MEDIEN_ALTER,
          },
        },
      }),
    );

    await tippeGeburtsdatum(user, geborenVor(MEDIEN_ALTER));
    await user.click(screen.getByRole("button", { name: "Eintrag bestätigen" }));
    await act(fetchMock.answered);
    const zeile = screen.queryByText("Fotos, Videos und Interviews")?.parentElement?.textContent ?? "";

    assert.match(zeile, /Fotos, Videos und Interviews\s*erlaubt/, "the panel names no media consent, or not the one stored");
  });

  it("withdraws the switch and its yes when the date moves below the media age", async () => {
    const { sent } = answerEveryFetch();
    const user = userEvent.setup();
    renderPanel();

    await tippeGeburtsdatum(user, geborenVor(MEDIEN_ALTER + 2));
    await user.click(screen.getByRole("switch", { name: KONTAKT.bedienelemente.medien }));
    await tippeGeburtsdatum(user, geborenVor(MEDIEN_ALTER - 1));

    assert.ok(keinSchalter(), "the switch stands for a date under the media age");

    await user.click(screen.getByRole("button", { name: "Eintrag bestätigen" }));
    await act(fetchMock.answered);

    assert.equal(sent.length, 1, "the press sent nothing, so this case compares nothing");
    assert.equal(sent[0]?.medien, false, "the yes given at the older date was sent for the younger one");
  });

  /* A Widerspruch empties the seat, so a yes switched on before it is a consent no record holds. */
  it("sends no media consent with a Widerspruch, whatever the switch held", async () => {
    const { sent } = answerEveryFetch();
    const user = userEvent.setup();
    renderPanel();

    await tippeGeburtsdatum(user, geborenVor(MEDIEN_ALTER + 2));
    await user.click(screen.getByRole("switch", { name: KONTAKT.bedienelemente.medien }));
    await pressTwice(user, { resting: ABLEHNEN_LABEL, armed: /Widerspruch/ });
    await act(fetchMock.answered);

    assert.equal(sent.length, 1, "the objection sent nothing, so this case compares nothing");
    assert.deepEqual([sent[0]?.antwort, sent[0]?.medien], ["abgelehnt", false], "the objection carried the media consent");
  });
});
