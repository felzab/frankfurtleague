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
import { LINK_ADRESSE_GESPERRT } from "@/shared/utils/reopenLink.ts";

import type { SchiedsrichterAdresswechselStart } from "./SchiedsrichterAdresswechselView.tsx";

const { raised: toasts } = doubleToasts();
const fetchMock = doubleFetch();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { JA_MEINE_ADRESSE, NICHT_MEINE_ADRESSE, SchiedsrichterAdresswechselView } = await import("./SchiedsrichterAdresswechselView.tsx");

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
  it("names the referee, the deadline and both answers on an open link", () => {
    const shown = words(OFFEN);

    assert.match(shown, /für Anna als Schiedsrichterin oder Schiedsrichter eingetragen/);
    assert.match(shown, /15\.10\.2026/);
    assert.ok(shown.includes(JA_MEINE_ADRESSE) && shown.includes(NICHT_MEINE_ADRESSE), "an answer is missing");
  });

  /* A dead link may have been forwarded, so no panel past the open one names anybody. */
  for (const zustand of ["abgelaufen", "ungueltig"] as const) {
    it(`says a ${zustand} link is void, names nobody and keeps the address in force`, () => {
      const shown = words({ zustand: zustand });

      assert.match(shown, /ungültig oder abgelaufen/);
      assert.match(shown, /Deine bisherige Adresse gilt weiter/);
      assert.doesNotMatch(shown, /Anna/);
    });
  }

  it("a barred address opens on the ban's sentence and nothing else (`docs/frontend/spec.md :: I516`)", () => {
    const shown = words({ zustand: "gesperrt" });

    assert.ok(shown.includes(LINK_ADRESSE_GESPERRT));
    assert.doesNotMatch(shown, /bestätigen/);
  });

  it("asks for a reload on a link nobody could check, rather than calling it void", () => {
    assert.match(words({ zustand: "unlesbar" }), /gerade nicht prüfen/);
  });

  for (const [gedrueckt, antwort, ergebnis] of [
    [JA_MEINE_ADRESSE, "bestaetigt", /Deine neue E-Mail-Adresse gilt jetzt/],
    [NICHT_MEINE_ADRESSE, "abgelehnt", /Wir haben die Adresse wieder entfernt/],
  ] as const) {
    it(`sends „${gedrueckt}“ as ${antwort} with the link's token and shows its result`, async () => {
      const { sent } = answerEveryFetch({ success: true, antwort: antwort });

      render(h(SchiedsrichterAdresswechselView, { start: OFFEN }));
      await userEvent.setup().click(screen.getByRole("button", { name: gedrueckt }));
      await act(fetchMock.answered);

      await waitFor(() => assert.match(document.body.textContent, ergebnis));
      assert.deepEqual(sent, [{ token: "abc123", antwort: antwort }]);
    });
  }

  /* The link died between the open and the press: its panel replaces the answers, never a toast. */
  it("turns a link that lapsed under the press into the void panel", async () => {
    answerEveryFetch({ success: false, zustand: "abgelaufen" });

    render(h(SchiedsrichterAdresswechselView, { start: OFFEN }));
    await userEvent.setup().click(screen.getByRole("button", { name: JA_MEINE_ADRESSE }));
    await act(fetchMock.answered);

    await waitFor(() => assert.match(document.body.textContent, /ungültig oder abgelaufen/));
    assert.deepEqual(toasts, []);
  });
});
