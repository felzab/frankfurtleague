import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { KONTAKT_EMAIL } from "@/core/brand.ts";
import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";
import { assertOwnPanel, resultPanels } from "@/shared/testing/resultPanels.ts";
import { LINK_ADRESSE_GESPERRT } from "@/shared/utils/reopenLink.ts";

import type { SpielbestaetigungStart } from "./SpielbestaetigungView.tsx";

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();
const fetchMock = doubleFetch();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SpielbestaetigungView } = await import("./SpielbestaetigungView.tsx");
const { ANDEREN_TERMIN_VORSCHLAGEN } = await import("./SpielbestaetigungFormPanel.tsx");
const { LinkUnlesbar } = await import("@/features/bewerbungen/components/views/BestaetigungPanels.tsx");
const { NAME_IN_BEGRUENDUNG } = await import("@/features/spielbestaetigungen/utils.ts");

const TOKEN = "abc123";

/** The fixture as the view serves it: the reader's club is the guest. */
const ANSICHT = {
  acknowledged: 1,
  zustand: "gueltig",
  seite: "team2",
  ansetzung: {
    team1_name: "FC Alpha",
    team2_name: "Lessing-Kolleg",
    datum: "2026-11-07",
    uhrzeit: "14:30:00",
    spielort: { spielort_id: "6890a1b2c3d4e5f607250001", name: "Sportpark Nord", maps_link: "https://maps.example.org" },
  },
  frist: "2026-10-31",
  vorschlag: null,
  beantwortet_von: null,
} as const;

const OFFEN: SpielbestaetigungStart = { zustand: "gueltig", token: TOKEN, ansicht: ANSICHT };

const VORSCHLAG: SpielbestaetigungStart = {
  zustand: "vorschlag",
  token: TOKEN,
  ansicht: { ...ANSICHT, zustand: "vorschlag", vorschlag: { datum: "2026-11-14", uhrzeit: "16:00:00" } },
};

const ZUGESAGT_VON_ANSPRECHPERSON: SpielbestaetigungStart = {
  zustand: "zugesagt",
  beantwortet_von: { art: "kontakt", rolle: "ansprechperson" },
};

const DEAD = "Dieser Link ist ungültig oder abgelaufen.";

/**
 * The words on screen. Read across element boundaries so a marked name does not fuse with its
 * neighbour, then closed up again at the punctuation that followed it.
 */
const words = (html: string): string =>
  textOf(html, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();

const markup = (start: SpielbestaetigungStart): string => renderTree(h(SpielbestaetigungView, { start }));

/** The route handler's answer to every request of the case, each body recorded as it was sent. */
function answerEveryFetch(answer: unknown): { sent: unknown[] } {
  const sent: unknown[] = [];
  fetchMock.mock.mockImplementation((_input, init) => {
    sent.push(JSON.parse(typeof init?.body === "string" ? init.body : "null"));

    return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
  });

  return { sent: sent };
}

/** A date as the picker's segments take it typed: day, month, year. */
const getippt = (datum: string): string => {
  const [jahr, monat, tag] = datum.split("-");
  return `${tag ?? ""}${monat ?? ""}${jahr ?? ""}`;
};

/** Opens the proposal and fills its date, its kick-off and, where given, its reason. */
async function schlageVor(
  user: ReturnType<typeof userEvent.setup>,
  { datum, uhrzeit, begruendung }: { datum: string; uhrzeit: string; begruendung?: string },
): Promise<void> {
  await user.click(screen.getByRole("button", { name: ANDEREN_TERMIN_VORSCHLAGEN }));
  const [tag] = within(screen.getByRole("group", { name: "Neues Datum" })).getAllByRole("spinbutton");
  await user.click(tag ?? assert.fail("the proposal renders no date to type"));
  await user.keyboard(getippt(datum));
  // The field and its segment group both take the label's name, the segments sitting in either.
  const [anpfiff] = screen.getAllByRole("group", { name: "Neuer Anpfiff" });
  const [stunde] = within(anpfiff ?? assert.fail("the proposal renders no kick-off")).getAllByRole("spinbutton");
  await user.click(stunde ?? assert.fail("the proposal renders no kick-off to type"));
  await user.keyboard(uhrzeit.replace(":", ""));
  if (begruendung !== undefined) await user.type(screen.getByRole("textbox", { name: /Begründung/ }), begruendung);
}

afterEach(() => {
  toasts.length = 0;
});

describe("the fixture confirmation page", () => {
  it("names the reader's club, the fixture and the deadline on an open link", () => {
    const shown = words(markup(OFFEN));

    assert.ok(shown.includes("Du antwortest für Lessing-Kolleg."), "the page does not say which club the answer is for");
    assert.ok(shown.includes("FC Alpha gegen Lessing-Kolleg"));
    assert.ok(shown.includes("07.11.2026") && shown.includes("14:30") && shown.includes("Sportpark Nord"));
    assert.ok(shown.includes("Antworte bis zum 31.10.2026."), "the page states no deadline");
  });

  /* The opponent's proposal is in front of the reader, and the reader still answers the date standing. */
  it("shows the other club's proposal and still offers the reader's own answer", () => {
    render(h(SpielbestaetigungView, { start: VORSCHLAG }));
    const shown = document.body.textContent ?? "";

    assert.ok(shown.includes("FC Alpha hat einen anderen Termin vorgeschlagen: 14.11.2026 um 16:00 Uhr."), shown);
    assert.ok(screen.getByRole("button", { name: /Zusagen/ }));
    assert.ok(screen.getByRole("button", { name: ANDEREN_TERMIN_VORSCHLAGEN }));
  });

  it("states that the league sets the date after the deadline, and gives its contact, on a dead link", () => {
    for (const zustand of ["abgelaufen", "ungueltig"] as const) {
      const shown = words(markup({ zustand }));
      assert.ok(shown.includes("Ist die Frist vorbei, legt die Liga den Termin fest."), `the ${zustand} panel says nothing of the deadline`);
      assert.ok(shown.includes(KONTAKT_EMAIL), `the ${zustand} panel gives no contact`);
    }
  });

  /* A seat names a role and never a person, and it is what tells the club's other two seats who answered. */
  it("names the seat that answered an answered link, and nothing of the fixture", () => {
    const shown = words(markup(ZUGESAGT_VON_ANSPRECHPERSON));

    assert.ok(shown.includes("Zugesagt von Ansprechperson"), shown);
    assert.ok(words(markup({ zustand: "abgelehnt", beantwortet_von: { art: "admin" } })).includes("Abgesagt von Verwaltung der Liga"));
  });

  it("keeps the unreadable link apart from the dead one", () => {
    assert.match(words(markup({ zustand: "unlesbar" })), /gerade nicht prüfen/);
    assert.ok(!words(markup({ zustand: "unlesbar" })).includes("ungültig oder abgelaufen"));
  });

  // A second panel beside a state's own tells the reader two outcomes, which each case above misses.
  it("shows each state's own panel and no other", () => {
    const [unlesbar = ""] = resultPanels(renderTree(h(LinkUnlesbar, {})));
    assert.match(unlesbar, /gerade nicht prüfen/, "the shared panel no longer says the link went unchecked");

    for (const [start, eigenes] of [
      [OFFEN, null],
      [VORSCHLAG, null],
      [ZUGESAGT_VON_ANSPRECHPERSON, "Für dieses Spiel hat Dein Team schon zugesagt."],
      [
        { zustand: "abgelehnt", beantwortet_von: { art: "kontakt", rolle: "trainer" } },
        "Für dieses Spiel hat Dein Team den Termin schon abgesagt.",
      ],
      [{ zustand: "abgelaufen" }, DEAD],
      [{ zustand: "ungueltig" }, DEAD],
      [{ zustand: "gesperrt" }, LINK_ADRESSE_GESPERRT],
      [{ zustand: "unlesbar" }, unlesbar],
    ] satisfies [SpielbestaetigungStart, string | null][]) {
      assertOwnPanel(markup(start), eigenes, start.zustand);
    }
  });
});

describe("what the press sends", () => {
  it("sends a Zusage carrying neither a proposal nor a reason, and shows its receipt", async () => {
    const { sent } = answerEveryFetch({ success: true, zustand: "zugesagt", vorschlag: null });

    render(h(SpielbestaetigungView, { start: OFFEN }));
    await userEvent.setup().click(screen.getByRole("button", { name: /Zusagen/ }));
    await act(fetchMock.answered);

    assert.deepEqual(sent, [{ token: TOKEN, antwort: "zugesagt", vorschlag: null, begruendung: null }]);
    assert.ok(await screen.findByRole("heading", { name: "Termin bestätigt" }));
    assertOwnPanel(document.body.innerHTML, "Für Lessing-Kolleg ist der Termin bestätigt.", "zugesagt-neu");
  });

  it("sends a proposal as a decline carrying the typed date, kick-off and reason", async () => {
    const { sent } = answerEveryFetch({ success: true, zustand: "abgelehnt", vorschlag: { datum: "2026-11-14", uhrzeit: "16:00:00" } });
    const user = userEvent.setup();

    render(h(SpielbestaetigungView, { start: OFFEN }));
    await schlageVor(user, { datum: "2026-11-14", uhrzeit: "16:00", begruendung: "Klassenfahrt" });
    await user.click(screen.getByRole("button", { name: /Vorschlag senden/ }));
    await act(fetchMock.answered);

    assert.deepEqual(sent, [
      { token: TOKEN, antwort: "abgelehnt", vorschlag: { datum: "2026-11-14", uhrzeit: "16:00:00" }, begruendung: "Klassenfahrt" },
    ]);
    assert.ok(await screen.findByRole("heading", { name: "Vorschlag gesendet" }));
    assertOwnPanel(document.body.innerHTML, "Dein Vorschlag für Lessing-Kolleg ist bei der Liga.", "abgelehnt-neu");
    assert.ok(resultPanels(document.body.innerHTML)[0]?.includes("14.11.2026"), "the receipt does not read the proposal back");
  });

  it("sends an empty reason as none", async () => {
    const { sent } = answerEveryFetch({ success: true, zustand: "abgelehnt", vorschlag: { datum: "2026-11-14", uhrzeit: "16:00:00" } });
    const user = userEvent.setup();

    render(h(SpielbestaetigungView, { start: OFFEN }));
    await schlageVor(user, { datum: "2026-11-14", uhrzeit: "16:00" });
    await user.click(screen.getByRole("button", { name: /Vorschlag senden/ }));
    await act(fetchMock.answered);

    assert.equal((sent[0] as { begruendung?: unknown } | undefined)?.begruendung, null);
  });

  /* A decline without a date would leave the league nothing to decide on, which the endpoint refuses. */
  it("sends no proposal that names no date", async () => {
    const { sent } = answerEveryFetch({ success: true, zustand: "abgelehnt", vorschlag: null });
    const user = userEvent.setup();

    render(h(SpielbestaetigungView, { start: OFFEN }));
    await user.click(screen.getByRole("button", { name: ANDEREN_TERMIN_VORSCHLAGEN }));
    await user.click(screen.getByRole("button", { name: /Vorschlag senden/ }));

    assert.deepEqual(sent, []);
  });
});

describe("what a refused press does to the page", () => {
  /* The link died between the open and the press: the panel replaces the form rather than a toast over a form
     nobody can submit again. */
  for (const [zustand, ueberschrift, eigenes] of [
    ["ungueltig", "Link ungültig", DEAD],
    ["abgelaufen", "Link ungültig", DEAD],
  ] as const) {
    it(`swaps the form for the ${zustand} panel`, async () => {
      answerEveryFetch({ success: false, zustand: zustand });

      render(h(SpielbestaetigungView, { start: OFFEN }));
      await userEvent.setup().click(screen.getByRole("button", { name: /Zusagen/ }));
      await act(fetchMock.answered);

      assert.ok(await screen.findByRole("heading", { name: ueberschrift }), "the page kept the form the press cannot use again");
      assertOwnPanel(document.body.innerHTML, eigenes, zustand);
      assert.ok(screen.queryByRole("button", { name: /Zusagen/ }) === null);
      assert.deepEqual(toasts, [], "a dead link was reported as a toast over a dead form");
    });
  }

  /* Another seat of the club answered while the page stood open: the panel names which one. */
  it("swaps the form for the answered panel naming the seat the route read back", async () => {
    answerEveryFetch({ success: false, zustand: "zugesagt", beantwortet_von: { art: "kontakt", rolle: "trainer" } });

    render(h(SpielbestaetigungView, { start: OFFEN }));
    await userEvent.setup().click(screen.getByRole("button", { name: /Zusagen/ }));
    await act(fetchMock.answered);

    assert.ok(await screen.findByRole("heading", { name: "Schon erledigt" }));
    assert.ok((document.body.textContent ?? "").includes("Trainerin oder Trainer"), "the panel names no seat");
  });

  /* A refusal of the proposal spends nothing: it lands on the box that caused it, and the typed proposal stays. */
  it("marks the reason box with the name refusal, keeping the form", async () => {
    answerEveryFetch({ success: false, fieldErrors: { begruendung: NAME_IN_BEGRUENDUNG } });
    const user = userEvent.setup();

    render(h(SpielbestaetigungView, { start: OFFEN }));
    await schlageVor(user, { datum: "2026-11-14", uhrzeit: "16:00", begruendung: "Kein Platz" });
    await user.click(screen.getByRole("button", { name: /Vorschlag senden/ }));
    await act(fetchMock.answered);

    await waitFor(() => assert.ok(screen.getByText(NAME_IN_BEGRUENDUNG), "the reason box shows no refusal"));
    assert.ok(screen.getByRole("button", { name: /Vorschlag senden/ }), "the form went with a refusal that spends nothing");
  });
});
