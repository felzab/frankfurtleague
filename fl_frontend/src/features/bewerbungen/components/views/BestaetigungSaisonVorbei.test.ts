import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { laufendeKontaktSaisonFassung } from "@/shared/testing/einwilligungAnswers.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";
import { ANTWORT_UNKLAR } from "@/shared/utils/publicSubmit.ts";

import { ABLEHNEN_LABEL, VERTRETUNG_MIN_ALTER } from "../../constants.ts";

import type { BestaetigungStart } from "./BestaetigungView.tsx";

const fetchMock = doubleFetch();
/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised } = doubleToasts();

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
    zeile: "saison_vorbei",
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

  /* The view names the one cause, as the mail does: a page naming both would tell a person whose
     season is still running that it might be over. */
  for (const [zeile, gilt, nichtGilt] of [
    ["saison_vorbei", "Die Saison 2627 ist für das Team Lessing-Kolleg vorbei.", "spielt in der Saison"],
    ["ausgetreten", "Das Team Lessing-Kolleg spielt in der Saison 2627 nicht mehr mit.", "vorbei"],
  ] as const) {
    it(`names the one cause that applies, ${zeile}`, () => {
      if (VORBEI.zustand !== "saison_vorbei") assert.fail("the fixture opens no closed row");
      const text = textOf(renderMarkup(BestaetigungView, { start: { ...VORBEI, ansicht: { ...VORBEI.ansicht, zeile } } }), " ").replace(
        /\s+/g,
        " ",
      );

      assert.ok(text.includes(gilt), `the page does not name its cause: ${text}`);
      assert.ok(!text.includes(nichtGilt), "the page names the cause that does not apply");
      assert.ok(!text.includes(" oder das Team"), "the page names both causes at once");
    });
  }

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

  /** The toasts a refused Widerspruch raises, and whether the offer still stands after it. */
  async function pressAgainst(answer: unknown): Promise<{ toasts: [string, string, unknown][]; offerStands: boolean }> {
    raised.length = 0;
    answerEveryFetch(answer);
    const user = userEvent.setup();
    const { unmount } = render(h(BestaetigungView, { start: VORBEI }));

    await pressTwice(user, { resting: ABLEHNEN_LABEL, armed: /Widerspruch/ });
    await act(fetchMock.answered);
    const offerStands = screen.queryByRole("button", { name: ABLEHNEN_LABEL }) !== null;
    unmount();

    return { toasts: raised.map(({ variant, title, description }) => [variant, title, description]), offerStands };
  }

  /* A refusal naming no state of the link leaves the offer standing, so the person can press again,
     and says the Widerspruch was not taken in the answer's own sentence. */
  it("names a refusal under the Widerspruch's own title, and keeps the offer", async () => {
    const { toasts, offerStands } = await pressAgainst({ success: false, error: "Der Eintrag wurde gerade geändert. Versuche es erneut." });

    assert.deepEqual(toasts, [["danger", "Widerspruch nicht gespeichert", "Der Eintrag wurde gerade geändert. Versuche es erneut."]]);
    assert.ok(offerStands, "a refused Widerspruch took the offer away");
  });

  /* The Widerspruch may have landed, so the envelope's own sentence, an administrator's repair, is
     not the visitor's: the page sends them back to the link, which says whether it was taken. */
  it("titles a Widerspruch of unknown outcome as unclear, and sends the person back to the link", async () => {
    const { toasts } = await pressAgainst({ success: false, outcome: "unknown", error: "Ob der Widerspruch gespeichert wurde, ist unklar." });

    assert.deepEqual(toasts, [["danger", "Unklar, ob es bei uns angekommen ist", ANTWORT_UNKLAR]]);
  });
});
