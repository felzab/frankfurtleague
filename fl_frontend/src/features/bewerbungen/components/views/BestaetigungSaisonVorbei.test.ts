import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { laufendeKontaktSaisonFassung } from "@/shared/testing/einwilligungAnswers.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import { ABLEHNEN_LABEL, VERTRETUNG_MIN_ALTER } from "../../constants.ts";

import type { BestaetigungStart } from "./BestaetigungView.tsx";

const fetchMock = doubleFetch();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { BestaetigungView } = await import("./BestaetigungView.tsx");

/** The season row's running label, which the view names for a seat an administrator filled there. */
const LABEL = laufendeKontaktSaisonFassung().textVersion;

const VORBEI: BestaetigungStart = {
  zustand: "saison_vorbei",
  token: "kein-echtes-token",
  ansicht: {
    acknowledged: 1,
    zustand: "saison_vorbei",
    quelle: "saison",
    saison_id: "2627",
    schule: "Lessing-Kolleg",
    rolle: "ansprechperson",
    zugleich_rolle: null,
    vorname: "Mira",
    text_version: LABEL,
    laufende_fassung: LABEL,
    mindestalter: VERTRETUNG_MIN_ALTER,
    medien_mindestalter: 18,
  },
};

/** The route handler's answer to every request of the case, each body recorded as it was sent. */
function answerEveryFetch(answer: unknown): { sent: Record<string, unknown>[] } {
  const sent: Record<string, unknown>[] = [];
  fetchMock.mock.mockImplementation((_input, init) => {
    sent.push(JSON.parse(typeof init?.body === "string" ? init.body : "null") as Record<string, unknown>);
    return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
  });

  return { sent: sent };
}

/* The backend takes no confirmation once the season has ended or the team has left it, and still
   takes a Widerspruch (`REQ-KONTAKT-006`): the page offers that alone, and says why. */
describe("a season row's link past its season", () => {
  it("offers the Widerspruch alone, saying why no confirmation is taken", () => {
    const html = renderMarkup(BestaetigungView, { start: VORBEI });
    const text = textOf(html);

    assert.ok(text.includes("Deinen Eintrag kannst Du deshalb nicht mehr bestätigen."), "the page does not say why nothing is confirmed");
    // No greeting: the other confirmation pages open on their facts, and none says „Hallo“.
    assert.ok(!text.includes("Hallo"), "the page opens on a greeting no sibling page has");
    assert.ok(text.includes(ABLEHNEN_LABEL), "the page offers no Widerspruch");
    assert.ok(!text.includes("Eintrag bestätigen"), "the page offers a confirmation the backend refuses");
    assert.ok(!html.includes('name="geburtsdatum"'), "the page asks a birthdate nothing will store");
  });

  it("sends a Widerspruch under the view's label and shows it taken", async () => {
    const { sent } = answerEveryFetch({ success: true });
    const user = userEvent.setup();
    const { unmount } = render(h(BestaetigungView, { start: VORBEI }));

    await pressTwice(user, { resting: ABLEHNEN_LABEL, armed: /Widerspruch/ });
    await act(fetchMock.answered);
    const genommen = screen.queryByText(/Deine Angaben haben wir aus dem Eintrag entfernt\./) !== null;
    unmount();

    assert.deepEqual(sent, [
      { token: "kein-echtes-token", antwort: "abgelehnt", geburtsdatum: null, whatsapp: false, medien: false, text_version: LABEL },
    ]);
    assert.ok(genommen, "the page does not say the Widerspruch was taken");
  });

  /* A link past its own deadline by the press takes no Widerspruch either: the dead-link panel. */
  it("swaps to the panel a refused press answers", async () => {
    answerEveryFetch({ success: false, zustand: "abgelaufen" });
    const user = userEvent.setup();
    const { unmount } = render(h(BestaetigungView, { start: VORBEI }));

    await pressTwice(user, { resting: ABLEHNEN_LABEL, armed: /Widerspruch/ });
    await act(fetchMock.answered);
    const tot = screen.queryByText(/Dieser Link ist ungültig oder abgelaufen\./) !== null;
    unmount();

    assert.ok(tot, "a refused Widerspruch left the offer standing");
  });
});
