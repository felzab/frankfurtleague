import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { JA_MEINE_ADRESSE, NICHT_MEINE_ADRESSE } from "@/core/adresswechselAntworten.ts";
import { doubleLogger, doubleToasts, loggedErrorCodes } from "@/shared/testing/actionDoubles.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { answerReadsWith, backendUnreachable, pageBody } from "@/shared/testing/pageHarness.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";
import { assertOwnPanel, resultPanels } from "@/shared/testing/resultPanels.ts";
import { LINK_ADRESSE_GESPERRT } from "@/shared/utils/reopenLink.ts";

import type { SpielerAdresswechselStart } from "@/features/spieler/adresswechselStart.ts";
import type { ReactElement } from "react";

const { raised: toasts } = doubleToasts();
const fetchMock = doubleFetch();
doubleLogger();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SpielerAdresswechselView } = await import("./SpielerAdresswechselView.tsx");
const { startOf } = await import("@/features/spieler/adresswechselStart.ts");
const { LinkUnlesbar } = await import("@/features/bewerbungen/components/views/BestaetigungPanels.tsx");
const { default: SpielerAdresswechselPage } = await import("@/app/(public)/bestaetigung/spieler/adresse/page.tsx");

/** What the page opens its view on, the link's read answered as the case set it. */
const pageStart = async (): Promise<SpielerAdresswechselStart> =>
  (
    (await pageBody(SpielerAdresswechselPage, {
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ token: "kein-echtes-token" }),
    })) as ReactElement<{ start: SpielerAdresswechselStart }>
  ).props.start;

const OFFEN: SpielerAdresswechselStart = { zustand: "gueltig", frist: "2026-10-29", token: "abc123" };

const words = (start: SpielerAdresswechselStart): string =>
  textOf(renderTree(h(SpielerAdresswechselView, { start })), " ")
    .replace(/\s+/g, " ")
    .trim();

/** The route handler's answer to every request of the case, each body recorded as it was sent. */
function answerEveryFetch(answer: unknown): { sent: unknown[]; urls: string[] } {
  const sent: unknown[] = [];
  const urls: string[] = [];
  fetchMock.mock.mockImplementation((input, init) => {
    urls.push(String(input));
    sent.push(JSON.parse(typeof init?.body === "string" ? init.body : "null"));

    return Promise.resolve(new Response(JSON.stringify(answer), { status: 200 }));
  });

  return { sent: sent, urls: urls };
}

afterEach(() => {
  toasts.length = 0;
});

describe("the pupil's address page", () => {
  it("offers the confirmation first and the decline after it, as the exit", () => {
    render(h(SpielerAdresswechselView, { start: OFFEN }));

    assert.deepEqual(
      screen.getAllByRole("button").map((button) => button.textContent.trim()),
      [JA_MEINE_ADRESSE, NICHT_MEINE_ADRESSE],
    );
  });

  it("names the entry and the deadline on an open link", () => {
    const shown = words(OFFEN);

    assert.match(shown, /für Deinen Eintrag als Spielerin oder Spieler eingetragen/);
    assert.match(shown, /29\.10\.2026/);
  });

  /* The decline outlives the deadline and the ban (`docs/frontend/spec.md :: I630`): the address goes whatever stands. */
  for (const zustand of ["abgelaufen", "nicht_bestaetigbar"] as const) {
    it(`offers the decline alone on a link ${zustand}, naming nobody`, () => {
      const shown = words({ zustand, token: "abc123" });

      assert.ok(shown.includes(NICHT_MEINE_ADRESSE), "the decline is missing");
      assert.ok(!shown.includes(JA_MEINE_ADRESSE), "a closed link offers the confirmation");
      assert.doesNotMatch(shown, /Lena/);
    });
  }

  /* The replaced address barred, or another pupil holding the new one: the holder of this mailbox may be a stranger to both. */
  it("names neither a ban nor another pupil on a change it can no longer confirm", () => {
    assert.doesNotMatch(words({ zustand: "nicht_bestaetigbar", token: "abc123" }), /gesperrt|Sperre|bisherige|andere/);
  });

  it("states the lapsed link's clock, and that the address in force stays", () => {
    assert.match(words({ zustand: "abgelaufen", token: "abc123" }), /Ein Link gilt 14 Tage\..*Bis dahin gilt die bisherige Adresse\./);
  });

  it("says an unknown link is void in words true after a confirmation too, and names nobody", () => {
    const shown = words({ zustand: "ungueltig" });

    assert.match(shown, /Hast Du die neue Adresse schon bestätigt, gilt sie bereits\. Sonst gilt die bisherige weiter\./);
    assert.doesNotMatch(shown, /Lena/);
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

    for (const [start, eigenes] of [
      [OFFEN, null],
      [{ zustand: "abgelaufen", token: "abc123" }, "Dieser Link ist abgelaufen."],
      [{ zustand: "nicht_bestaetigbar", token: "abc123" }, "kann nicht mehr bestätigt werden."],
      [{ zustand: "ungueltig" }, "Dieser Link ist ungültig:"],
      [{ zustand: "gesperrt" }, LINK_ADRESSE_GESPERRT],
      [{ zustand: "unlesbar" }, unlesbar],
    ] satisfies [SpielerAdresswechselStart, string | null][]) {
      assertOwnPanel(renderTree(h(SpielerAdresswechselView, { start })), eigenes, start.zustand);
    }
  });

  for (const [gedrueckt, antwort, ergebnis] of [
    [JA_MEINE_ADRESSE, "bestaetigt", /Deine neue E-Mail-Adresse gilt jetzt.*gilt er für die neue nicht/s],
    [NICHT_MEINE_ADRESSE, "abgelehnt", /Wir haben die Adresse wieder entfernt/],
  ] as const) {
    it(`posts „${gedrueckt}“ as ${antwort} to the pupil's route with the link's token and shows its result`, async () => {
      const { sent, urls } = answerEveryFetch({ success: true, antwort: antwort });

      render(h(SpielerAdresswechselView, { start: OFFEN }));
      await userEvent.setup().click(screen.getByRole("button", { name: gedrueckt }));
      await act(fetchMock.answered);

      await waitFor(() => assert.match(document.body.textContent, ergebnis));
      assertOwnPanel(document.body.innerHTML, ergebnis, antwort);
      assert.deepEqual(sent, [{ token: "abc123", antwort: antwort }]);
      assert.deepEqual(urls, ["/api/bestaetigung/spieler/adresse"]);
    });
  }

  /* The link died between the open and the press: its panel replaces the answers, never a toast, and the decline stays on offer. */
  it("turns a link that lapsed under the press into the lapsed panel, keeping the token for the decline", async () => {
    const { sent } = answerEveryFetch({ success: false, zustand: "abgelaufen" });

    render(h(SpielerAdresswechselView, { start: OFFEN }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: JA_MEINE_ADRESSE }));
    await act(fetchMock.answered);
    await waitFor(() => assert.match(document.body.textContent, /Dieser Link ist abgelaufen/));
    assert.equal(screen.queryAllByRole("button", { name: JA_MEINE_ADRESSE }).length, 0);
    assert.deepEqual(toasts, []);

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

describe("the pupil's address page over an open link's read", () => {
  /* Whoever holds the link has proved no mailbox yet, and after a typo is a stranger, owed no minor's first name. */
  it("hands the view no first name from an open link's read", async () => {
    answerReadsWith(() => ({ acknowledged: 1, zustand: "gueltig", vorname: "Mirabel", frist: "2026-10-29" }));

    const start = await pageStart();

    assert.deepEqual(start, { zustand: "gueltig", frist: "2026-10-29", token: "kein-echtes-token" });
    assert.doesNotMatch(words(start), /Mirabel/);
  });
});

describe("the pupil's address page over a read that did not answer", () => {
  it("opens on its own state where the network never answered the read, rather than calling a live link void", async () => {
    answerReadsWith((endpoint) => {
      throw backendUnreachable(endpoint, "POST");
    });

    assert.deepEqual(await pageStart(), { zustand: "unlesbar" });
    assert.deepEqual(loggedErrorCodes(), [], "a read the network never answered was logged as a fault");
  });

  /* A bug in the read's narrowing opens the same panel as a read that failed, so only its line tells them apart. */
  it("logs a read that threw untyped, and opens on the same state", async () => {
    answerReadsWith(() => {
      throw new TypeError("Cannot read properties of undefined (reading 'zustand')");
    });

    assert.deepEqual(await pageStart(), { zustand: "unlesbar" });
    assert.deepEqual(loggedErrorCodes(), ["FE-RSC-001"], "the failure went unlogged");
  });

  /* An answer off its schema is a broken contract, never a failed read: the error boundary logs it, and the reload panel would hide it. */
  it("lets a read off its contract reach the error boundary", async () => {
    answerReadsWith(() => ({ acknowledged: 1, zustand: "verschollen", vorname: "Lena", frist: "2026-10-29" }));

    await assert.rejects(pageStart(), { name: "APIMalformedDataError" });
  });
});
