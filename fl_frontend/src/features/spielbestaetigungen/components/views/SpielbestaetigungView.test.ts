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
import { pressTwice } from "@/shared/testing/twoPress.ts";
import { LINK_ADRESSE_GESPERRT } from "@/shared/utils/reopenLink.ts";

import type { FLSpielbestaetigungAnsichtResponse } from "../../schemas.ts";
import type { SpielbestaetigungStart } from "./SpielbestaetigungView.tsx";

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();
const fetchMock = doubleFetch();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SpielbestaetigungView } = await import("./SpielbestaetigungView.tsx");
const { ANDEREN_TERMIN_VORSCHLAGEN } = await import("./SpielbestaetigungFormPanel.tsx");
const { LinkUnlesbar } = await import("@/features/bewerbungen/components/views/BestaetigungPanels.tsx");

const TOKEN = "abc123";

/** The route's words for a proposal before today (`REQ-ANSETZUNG-007`), on the date box. */
const IN_DER_VERGANGENHEIT = "Dieses Datum liegt in der Vergangenheit.";

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
} as const satisfies FLSpielbestaetigungAnsichtResponse;

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

const TERMIN_VORBEI = "Dieser Link ist abgelaufen: Der Spieltermin ist vorbei.";

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

/** Both presses of the Zusage, which the second alone sends. */
const sagZu = (user: ReturnType<typeof userEvent.setup>, whileArmed?: () => void): Promise<void> =>
  pressTwice(user, { resting: "Zusagen", armed: "Ja, zusagen", whileArmed });

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
    assert.ok(
      shown.includes("Danach legt die Verwaltung der Liga den Termin fest."),
      "the page does not say who sets the date past the deadline",
    );
  });

  /* The opponent's proposal is in front of the reader, and the reader still answers the date standing. */
  it("shows the other club's proposal and still offers the reader's own answer", () => {
    render(h(SpielbestaetigungView, { start: VORSCHLAG }));
    const shown = document.body.textContent ?? "";

    assert.ok(shown.includes("FC Alpha hat einen anderen Termin vorgeschlagen: 14.11.2026 um 16:00 Uhr."), shown);
    assert.ok(screen.getByRole("button", { name: /Zusagen/ }));
    assert.ok(screen.getByRole("button", { name: ANDEREN_TERMIN_VORSCHLAGEN }));
  });

  /* The way out is the button alone, as on the other link pages' dead-link panels: its sentence and the button, with
     no address, second sentence or other way out beside them. */
  it("states that the league sets the date after the deadline, and offers a question by mail, on a dead link", () => {
    for (const zustand of ["abgelaufen", "ungueltig"] as const) {
      const html = markup({ zustand });
      const shown = words(html);
      assert.deepEqual(
        resultPanels(html),
        // The panel's text as one run, the paragraph's and the button's meeting with no space between them.
        [
          `${DEAD} Wurde das Spiel verlegt, kommt eine neue E-Mail mit dem neuen Termin. Ist die Frist vorbei, legt die Verwaltung der Liga den Termin fest.Frage stellen`,
        ],
        `the ${zustand} panel holds more or less than its sentence and its button`,
      );
      assert.ok(html.includes(`href="mailto:${KONTAKT_EMAIL}"`), `the ${zustand} panel's button asks no question by mail`);
      assert.ok(!shown.includes(KONTAKT_EMAIL), `the ${zustand} panel writes the address out beside its button`);
    }
  });

  /* A match already due has no date left for the league to set: the panel says the day went by, and nothing of the
     deadline. */
  it("says the fixture's day went by, and offers a question by mail, on a link to a match already due", () => {
    const html = markup({ zustand: "termin-vorbei" });

    assert.deepEqual(resultPanels(html), [`${TERMIN_VORBEI}Frage stellen`]);
    assert.ok(html.includes(`href="mailto:${KONTAKT_EMAIL}"`), "the panel's button asks no question by mail");
    assert.match(words(html), /^Link ungültig/);
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
      [{ zustand: "termin-vorbei" }, TERMIN_VORBEI],
      [{ zustand: "ungueltig" }, DEAD],
      [{ zustand: "gesperrt" }, LINK_ADRESSE_GESPERRT],
      [{ zustand: "unlesbar" }, unlesbar],
    ] satisfies [SpielbestaetigungStart, string | null][]) {
      assertOwnPanel(markup(start), eigenes, start.zustand);
    }
  });
});

describe("what the press sends", () => {
  /* The first press of any of the club's seats binds the club, and the page offers no way back: one press must not commit. */
  it("arms a Zusage on the first press and sends it once on the second, carrying neither a proposal nor a reason", async () => {
    const { sent } = answerEveryFetch({ success: true, zustand: "zugesagt", vorschlag: null });

    render(h(SpielbestaetigungView, { start: OFFEN }));
    await sagZu(userEvent.setup(), () => {
      assert.deepEqual(sent, [], "the first press sent the Zusage");
      // One answer armed at a time, as the referee's panel hides its decline.
      assert.ok(screen.queryByRole("button", { name: ANDEREN_TERMIN_VORSCHLAGEN }) === null, "the proposal stands beside the armed Zusage");
    });
    await act(fetchMock.answered);

    assert.deepEqual(sent, [{ token: TOKEN, antwort: "zugesagt", vorschlag: null, begruendung: null }]);
    assert.ok(await screen.findByRole("heading", { name: "Termin bestätigt" }));
    assertOwnPanel(document.body.innerHTML, "Für Lessing-Kolleg ist der Termin bestätigt.", "zugesagt-neu");
    // A boolean rather than the node: a failing assertion's report inspects a jsdom node's whole window.
    const gelandet = document.activeElement === document.querySelector('section[role="status"]');
    assert.ok(gelandet, "the receipt replaced the form and the focus fell to the page");
  });

  it("sends nothing on a cancelled Zusage, and arms again on the next press", async () => {
    const { sent } = answerEveryFetch({ success: true, zustand: "zugesagt", vorschlag: null });
    const user = userEvent.setup();

    render(h(SpielbestaetigungView, { start: OFFEN }));
    await user.click(screen.getByRole("button", { name: "Zusagen" }));
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    assert.ok(screen.getByRole("button", { name: ANDEREN_TERMIN_VORSCHLAGEN }), "the cancel left the proposal hidden");
    await user.click(screen.getByRole("button", { name: "Zusagen" }));
    assert.ok(screen.getByRole("button", { name: "Ja, zusagen" }), "the press after a cancel did not arm");
    assert.deepEqual(sent, [], "a cancelled Zusage was sent");
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

  /* Both presses wait on the one write, and only the pressed one says so: a proposal button reading „Sendet...“ under
     a Zusage tells the reader the wrong answer is on its way. */
  for (const [gedrueckt, anderer, drueckt, gespeichert] of [
    ["Zusagen", "Vorschlag senden", sagZu, { success: true, zustand: "zugesagt", vorschlag: null }],
    [
      "Vorschlag senden",
      "Zusagen",
      (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole("button", { name: /Vorschlag senden/ })),
      { success: true, zustand: "abgelehnt", vorschlag: { datum: "2026-11-14", uhrzeit: "16:00:00" } },
    ],
  ] as const) {
    it(`keeps „${anderer}“ under its own words while „${gedrueckt}“ is sending`, async () => {
      let antworte: (antwort: Response) => void = () => assert.fail("the press sent no request");
      fetchMock.mock.mockImplementation(() => new Promise<Response>((resolve) => (antworte = resolve)));
      const user = userEvent.setup();

      render(h(SpielbestaetigungView, { start: OFFEN }));
      await schlageVor(user, { datum: "2026-11-14", uhrzeit: "16:00" });
      await drueckt(user);

      // Answered whatever the reading, so a failure here leaves no write in flight into the next case.
      try {
        // Hidden ones counted too: an armed Zusage hides the proposal, whose words must still not claim the write.
        const laufend = screen.getAllByRole("button", { name: /Sendet\.\.\.|Sagt zu\.\.\./, hidden: true });
        assert.equal(laufend.length, 1, "both presses read as sending, or neither");
        assert.ok(screen.getByRole("button", { name: new RegExp(anderer), hidden: true }), `„${anderer}“ lost its words under the other press`);
      } finally {
        antworte(new Response(JSON.stringify(gespeichert), { status: 200 }));
        await act(fetchMock.answered);
      }
    });
  }

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
    ["termin-vorbei", "Link ungültig", TERMIN_VORBEI],
  ] as const) {
    it(`swaps the form for the ${zustand} panel`, async () => {
      answerEveryFetch({ success: false, zustand: zustand });

      render(h(SpielbestaetigungView, { start: OFFEN }));
      await sagZu(userEvent.setup());
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
    await sagZu(userEvent.setup());
    await act(fetchMock.answered);

    assert.ok(await screen.findByRole("heading", { name: "Schon erledigt" }));
    assert.ok((document.body.textContent ?? "").includes("Trainerin oder Trainer"), "the panel names no seat");
  });

  /* A refusal of the proposal spends nothing: it lands on the box that caused it, and the typed proposal stays. */
  it("marks the date box with the past-date refusal, keeping the form", async () => {
    answerEveryFetch({ success: false, fieldErrors: { "vorschlag.datum": IN_DER_VERGANGENHEIT } });
    const user = userEvent.setup();

    render(h(SpielbestaetigungView, { start: OFFEN }));
    await schlageVor(user, { datum: "2026-11-14", uhrzeit: "16:00", begruendung: "Kein Platz" });
    await user.click(screen.getByRole("button", { name: /Vorschlag senden/ }));
    await act(fetchMock.answered);

    await waitFor(() => assert.ok(screen.getByText(IN_DER_VERGANGENHEIT), "the date box shows no refusal"));
    assert.ok(screen.getByRole("button", { name: /Vorschlag senden/ }), "the form went with a refusal that spends nothing");
    assert.equal(screen.getByRole<HTMLInputElement>("textbox", { name: /Begründung/ }).value, "Kein Platz", "the typed reason went");
    assert.equal(
      within(screen.getByRole("group", { name: "Neues Datum" }))
        .getAllByRole("spinbutton")
        .map((segment) => segment.textContent)
        .join("."),
      "14.11.2026",
      "the typed date went",
    );
  });
});
