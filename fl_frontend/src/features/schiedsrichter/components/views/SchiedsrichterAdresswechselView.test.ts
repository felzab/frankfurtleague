import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";
import { assertOwnPanel, resultPanels } from "@/shared/testing/resultPanels.ts";
import { LINK_ADRESSE_GESPERRT } from "@/shared/utils/reopenLink.ts";

import type { SchiedsrichterAdresswechselStart } from "@/features/schiedsrichter/adresswechselStart.ts";

const { raised: toasts } = doubleToasts();
const fetchMock = doubleFetch();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { JA_MEINE_ADRESSE, NICHT_MEINE_ADRESSE, SchiedsrichterAdresswechselView } = await import("./SchiedsrichterAdresswechselView.tsx");
const { startOf } = await import("@/features/schiedsrichter/adresswechselStart.ts");
const { LinkUnlesbar } = await import("@/features/bewerbungen/components/views/BestaetigungPanels.tsx");

const OFFEN: SchiedsrichterAdresswechselStart = { zustand: "gueltig", vorname: "Anna", frist: "2026-10-15", token: "abc123" };

const words = (start: SchiedsrichterAdresswechselStart): string =>
  textOf(renderTree(h(SchiedsrichterAdresswechselView, { start })), " ")
    .replace(/\s+/g, " ")
    .trim();

/** The route handler's answer to every request of the case, each body recorded as it was sent. */
function answerEveryFetch(answer: unknown): { sent: unknown[] } {
  const sent: unknown[] = [];
  fetchMock.mock.mockImplementation((_input, init) => {
    sent.push(JSON.parse(typeof init?.body === "string" ? init.body : "null"));

    return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
  });

  return { sent: sent };
}

afterEach(() => {
  toasts.length = 0;
});

describe("the referee's address page", () => {
  /* The contact page's order and grades: the confirmation first, the decline beside it as the row's exit. */
  it("offers the confirmation first and the decline after it, as the exit", () => {
    render(h(SchiedsrichterAdresswechselView, { start: OFFEN }));

    assert.deepEqual(
      screen.getAllByRole("button").map((button) => button.textContent.trim()),
      [JA_MEINE_ADRESSE, NICHT_MEINE_ADRESSE],
    );
    assert.match(screen.getByRole("button", { name: NICHT_MEINE_ADRESSE }).className, /bg-transparent/);
  });

  it("names the referee, the deadline and both answers on an open link", () => {
    const shown = words(OFFEN);

    assert.match(shown, /für Anna als Schiedsrichterin oder Schiedsrichter eingetragen/);
    assert.match(shown, /15\.10\.2026/);
    assert.ok(shown.includes(JA_MEINE_ADRESSE) && shown.includes(NICHT_MEINE_ADRESSE), "an answer is missing");
  });

  /* A dead link may have been forwarded, so no panel past the open one names anybody. */
  /* The commonest way here is reopening the link after confirming, so the panel never says the old address still holds. */
  it("says an unknown link is void in words true after a confirmation too, and names nobody", () => {
    const shown = words({ zustand: "ungueltig" });

    assert.match(shown, /Dieser Link ist ungültig/);
    assert.match(shown, /Hast Du die neue Adresse schon bestätigt, gilt sie bereits; sonst gilt die bisherige weiter/);
    assert.doesNotMatch(shown, /Deine bisherige Adresse gilt weiter/);
    assert.doesNotMatch(shown, /Anna/);
  });

  it("offers the decline alone on a lapsed link, which names nobody and keeps the address in force (`docs/frontend/spec.md :: I630`)", () => {
    const shown = words({ zustand: "abgelaufen", token: "abc123" });

    assert.match(shown, /Dieser Link ist abgelaufen/);
    assert.match(shown, /Bis dahin gilt die bisherige Adresse/);
    assert.ok(shown.includes(NICHT_MEINE_ADRESSE), "the decline is missing");
    assert.ok(!shown.includes(JA_MEINE_ADRESSE), "a lapsed link offers the confirmation");
    assert.doesNotMatch(shown, /Anna/);
  });

  /* The replaced address is barred, which the holder of the new mailbox may know nothing of (`REQ-SCHIEDSRICHTER-010`). */
  it("offers the decline alone on a change it can no longer confirm, naming neither the ban nor another address", () => {
    const shown = words({ zustand: "nicht_bestaetigbar", token: "abc123" });

    assert.match(shown, /kann nicht mehr bestätigt werden/);
    assert.ok(shown.includes(NICHT_MEINE_ADRESSE), "the decline is missing");
    assert.ok(!shown.includes(JA_MEINE_ADRESSE), "an unconfirmable change offers the confirmation");
    assert.doesNotMatch(shown, /gesperrt|Sperre|bisherige|Anna/);
  });

  it("turns a confirmation refused for the replaced address into that panel, the decline still reaching the change", async () => {
    const { sent } = answerEveryFetch({ success: false, zustand: "nicht_bestaetigbar" });

    render(h(SchiedsrichterAdresswechselView, { start: OFFEN }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: JA_MEINE_ADRESSE }));
    await act(fetchMock.answered);
    await waitFor(() => assert.match(document.body.textContent, /kann nicht mehr bestätigt werden/));
    assertOwnPanel(document.body.innerHTML, "kann nicht mehr bestätigt werden.", "nicht_bestaetigbar");

    await user.click(screen.getByRole("button", { name: NICHT_MEINE_ADRESSE }));
    await act(fetchMock.answered);

    assert.deepEqual(sent.at(-1), { token: "abc123", antwort: "abgelehnt" });
  });

  it("sends the decline from a lapsed link with its token and shows its result", async () => {
    const { sent } = answerEveryFetch({ success: true, antwort: "abgelehnt" });

    render(h(SchiedsrichterAdresswechselView, { start: { zustand: "abgelaufen", token: "abc123" } }));
    await userEvent.setup().click(screen.getByRole("button", { name: NICHT_MEINE_ADRESSE }));
    await act(fetchMock.answered);

    await waitFor(() => assert.match(document.body.textContent, /Wir haben die Adresse wieder entfernt/));
    assert.deepEqual(sent, [{ token: "abc123", antwort: "abgelehnt" }]);
  });

  it("a barred address opens on the ban's sentence and nothing else (`docs/frontend/spec.md :: I516`)", () => {
    const shown = words({ zustand: "gesperrt" });

    assert.ok(shown.includes(LINK_ADRESSE_GESPERRT));
    assert.doesNotMatch(shown, /bestätigen/);
  });

  it("asks for a reload on a link nobody could check, rather than calling it void", () => {
    assert.match(words({ zustand: "unlesbar" }), /gerade nicht prüfen/);
  });

  // A second panel beside a state's own tells the reader two outcomes, which each case above misses.
  it("shows each state's own panel and no other", () => {
    const [unlesbar = ""] = resultPanels(renderTree(h(LinkUnlesbar, {})));
    assert.match(unlesbar, /gerade nicht prüfen/, "the shared panel no longer says the link went unchecked");

    for (const [start, eigenes] of [
      [OFFEN, null],
      [{ zustand: "abgelaufen", token: "abc123" }, "Dieser Link ist abgelaufen."],
      [{ zustand: "nicht_bestaetigbar", token: "abc123" }, "kann nicht mehr bestätigt werden."],
      [{ zustand: "ungueltig" }, "Dieser Link ist ungültig:"],
      [{ zustand: "gesperrt" }, LINK_ADRESSE_GESPERRT],
      [{ zustand: "unlesbar" }, unlesbar],
    ] satisfies [SchiedsrichterAdresswechselStart, string | null][]) {
      assertOwnPanel(renderTree(h(SchiedsrichterAdresswechselView, { start })), eigenes, start.zustand);
    }
  });

  for (const [gedrueckt, antwort, ergebnis] of [
    [JA_MEINE_ADRESSE, "bestaetigt", /Deine neue E-Mail-Adresse gilt jetzt.*gilt er für die neue nicht/s],
    [NICHT_MEINE_ADRESSE, "abgelehnt", /Wir haben die Adresse wieder entfernt/],
  ] as const) {
    it(`sends „${gedrueckt}“ as ${antwort} with the link's token and shows its result`, async () => {
      const { sent } = answerEveryFetch({ success: true, antwort: antwort });

      render(h(SchiedsrichterAdresswechselView, { start: OFFEN }));
      await userEvent.setup().click(screen.getByRole("button", { name: gedrueckt }));
      await act(fetchMock.answered);

      await waitFor(() => assert.match(document.body.textContent, ergebnis));
      assertOwnPanel(document.body.innerHTML, ergebnis, antwort);
      assert.deepEqual(sent, [{ token: "abc123", antwort: antwort }]);
    });
  }

  /* The link died between the open and the press: its panel replaces the answers, never a toast. */
  it("turns a link that lapsed under the press into the lapsed panel, the decline still on offer", async () => {
    answerEveryFetch({ success: false, zustand: "abgelaufen" });

    render(h(SchiedsrichterAdresswechselView, { start: OFFEN }));
    await userEvent.setup().click(screen.getByRole("button", { name: JA_MEINE_ADRESSE }));
    await act(fetchMock.answered);

    await waitFor(() => assert.match(document.body.textContent, /Dieser Link ist abgelaufen/));
    assertOwnPanel(document.body.innerHTML, "Dieser Link ist abgelaufen.", "abgelaufen");
    assert.equal(screen.queryAllByRole("button", { name: JA_MEINE_ADRESSE }).length, 0);
    assert.deepEqual(toasts, []);
  });

  it("keeps the token through a lapse under the press, so the decline offered next still reaches the change", async () => {
    const { sent } = answerEveryFetch({ success: false, zustand: "abgelaufen" });

    render(h(SchiedsrichterAdresswechselView, { start: OFFEN }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: JA_MEINE_ADRESSE }));
    await act(fetchMock.answered);
    await waitFor(() => assert.match(document.body.textContent, /Dieser Link ist abgelaufen/));

    await user.click(screen.getByRole("button", { name: NICHT_MEINE_ADRESSE }));
    await act(fetchMock.answered);

    assert.deepEqual(sent, [
      { token: "abc123", antwort: "bestaetigt" },
      { token: "abc123", antwort: "abgelehnt" },
    ]);
  });

  /* The page's own reading of the read: only a state the backend still takes the decline in keeps the URL's token. */
  it("opens a lapsed read with the token and a void one without", () => {
    assert.deepEqual(startOf({ zustand: "abgelaufen" }, "abc123"), { zustand: "abgelaufen", token: "abc123" });
    assert.deepEqual(startOf({ zustand: "nicht_bestaetigbar" }, "abc123"), { zustand: "nicht_bestaetigbar", token: "abc123" });
    assert.deepEqual(startOf({ zustand: "ungueltig" }, "abc123"), { zustand: "ungueltig" });
    assert.deepEqual(startOf({ zustand: "gesperrt" }, "abc123"), { zustand: "gesperrt" });
  });
});
