import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { ADRESSWECHSEL_STOPPEN, JA_MEINE_ADRESSE, NICHT_MEINE_ADRESSE } from "@/core/adresswechselAntworten.ts";
import { KONTO_HREF } from "@/core/kontoHref.ts";
import { doubleLogger, doubleToasts, loggedErrorCodes, loggedErrorTraces } from "@/shared/testing/actionDoubles.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { answerReadsWith, backendUnreachable, EDGE_TRACE_ID, pageBody } from "@/shared/testing/pageHarness.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";
import { assertOwnPanel, resultPanels } from "@/shared/testing/resultPanels.ts";
import { LINK_ADRESSE_GESPERRT } from "@/shared/utils/reopenLink.ts";

import type { AdresswechselStart } from "@/features/konto/adresswechselLink.ts";
import type { NextPageProps } from "@/shared/types/types.ts";
import type { ReactElement } from "react";

const { raised: toasts } = doubleToasts();
const fetchMock = doubleFetch();
doubleLogger();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdresswechselLinkView } = await import("./AdresswechselLinkView.tsx");
const { startOf } = await import("@/features/konto/adresswechselLink.ts");
const { LinkUnlesbar } = await import("@/features/bewerbungen/components/views/BestaetigungPanels.tsx");
const { default: SpielerAdresswechselPage } = await import("@/app/(public)/bestaetigung/spieler/adresse/page.tsx");
const { default: SchiedsrichterAdresswechselPage } = await import("@/app/(public)/bestaetigung/schiedsrichter/adresse/page.tsx");

const ROUTE = "/api/bestaetigung/spieler/adresse";

/** 13:30 in Berlin, so a page stating it in UTC would print another hour. */
const OFFEN: AdresswechselStart = { zustand: "gueltig", gueltigBis: "2026-10-21T11:30:00Z", token: "abc123" };
const STOPP: AdresswechselStart = { zustand: "offen", gueltigBis: "2026-10-21T11:30:00Z", wirksamAb: null, token: "stopp-1" };

const words = (start: AdresswechselStart): string =>
  textOf(renderTree(h(AdresswechselLinkView, { route: ROUTE, start })), " ")
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

describe("the new mailbox's side of an address page", () => {
  it("offers the confirmation first and the decline after it, as the exit", () => {
    render(h(AdresswechselLinkView, { route: ROUTE, start: OFFEN }));

    assert.deepEqual(
      screen.getAllByRole("button").map((button) => button.textContent.trim()),
      [JA_MEINE_ADRESSE, NICHT_MEINE_ADRESSE],
    );
  });

  /* The change moves every record the address holds, so the page names no lane; the deadline is an instant. */
  it("names no lane, and states the deadline to the minute in Berlin", () => {
    const shown = words(OFFEN);

    assert.doesNotMatch(shown, /Spielerin|Schiedsrichter/);
    assert.match(shown, /Der Link gilt bis 21\. Oktober 2026 um 13:30 ?\./);
  });

  /* Told alike whatever the address holds: a sentence for an address holding records would answer a stranger whether it is known. */
  it("warns every open link that records already under the address join the sign-in", () => {
    assert.match(words(OFFEN), /Bestätige nur, wenn Du diese Änderung selbst angefragt hast\. Stehen unter dieser Adresse schon Einträge/);
  });

  /* The decline outlives the deadline and the ban (`docs/frontend/spec.md :: I630`): the address goes whatever stands. */
  for (const zustand of ["abgelaufen", "nicht_bestaetigbar"] as const) {
    it(`offers the decline alone on a link ${zustand}, naming nobody`, () => {
      const shown = words({ zustand, token: "abc123" });

      assert.ok(shown.includes(NICHT_MEINE_ADRESSE), "the decline is missing");
      assert.ok(!shown.includes(JA_MEINE_ADRESSE), "a closed link offers the confirmation");
    });
  }

  it("names neither a ban nor another pupil on a change it can no longer confirm", () => {
    assert.doesNotMatch(words({ zustand: "nicht_bestaetigbar", token: "abc123" }), /gesperrt|Sperre|bisherige|andere/);
  });

  it("states the lapsed link's clock, and that the address in force stays", () => {
    assert.match(words({ zustand: "abgelaufen", token: "abc123" }), /Ein Link gilt 24 Stunden\..*Bis dahin gilt die bisherige Adresse\./);
  });

  it("says an unknown link is void in words true after a confirmation and during a waiting time", () => {
    assert.match(
      words({ zustand: "ungueltig" }),
      /gilt sie bereits oder ab dem Zeitpunkt, den wir Dir genannt haben\. Sonst gilt die bisherige/,
    );
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
      [STOPP, null],
      [{ zustand: "abgelaufen", token: "abc123" }, "Dieser Link ist abgelaufen."],
      [{ zustand: "nicht_bestaetigbar", token: "abc123" }, "kann nicht mehr bestätigt werden."],
      [{ zustand: "ungueltig" }, "Dieser Link ist ungültig:"],
      [{ zustand: "gesperrt" }, LINK_ADRESSE_GESPERRT],
      [{ zustand: "unlesbar" }, unlesbar],
    ] satisfies [AdresswechselStart, string | null][]) {
      assertOwnPanel(renderTree(h(AdresswechselLinkView, { route: ROUTE, start })), eigenes, start.zustand);
    }
  });

  for (const [gedrueckt, antwort, wirksamAb, ergebnis] of [
    [JA_MEINE_ADRESSE, "bestaetigt", null, /Deine neue E-Mail-Adresse gilt jetzt.*gilt er für die neue nicht/s],
    // A change an administrator started with a reason takes effect only once its waiting time ends.
    [
      JA_MEINE_ADRESSE,
      "bestaetigt",
      "2026-10-28T12:30:00Z",
      /gilt ab 28\. Oktober 2026 um 13:30\. Bis dahin meldest Du Dich mit der bisherigen an/,
    ],
    [NICHT_MEINE_ADRESSE, "abgelehnt", null, /Wir haben die Adresse wieder entfernt/],
  ] as const) {
    it(`posts „${gedrueckt}“ as ${antwort} to the lane's route${wirksamAb === null ? "" : " into a waiting time"} and shows its result`, async () => {
      const { sent, urls } = answerEveryFetch({ success: true, antwort: antwort, wirksam_ab: wirksamAb });

      render(h(AdresswechselLinkView, { route: "/api/bestaetigung/schiedsrichter/adresse", start: OFFEN }));
      await userEvent.setup().click(screen.getByRole("button", { name: gedrueckt }));
      await act(fetchMock.answered);

      await waitFor(() => assert.match(document.body.textContent, ergebnis));
      assertOwnPanel(document.body.innerHTML, ergebnis, antwort);
      assert.deepEqual(sent, [{ token: "abc123", antwort: antwort }]);
      assert.deepEqual(urls, ["/api/bestaetigung/schiedsrichter/adresse"]);
    });
  }

  /* The link died between the open and the press: its panel replaces the answers, never a toast, and the decline stays on offer. */
  it("turns a link that lapsed under the press into the lapsed panel, keeping the token for the decline", async () => {
    const { sent } = answerEveryFetch({ success: false, zustand: "abgelaufen" });

    render(h(AdresswechselLinkView, { route: ROUTE, start: OFFEN }));
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

  /* The page's own reading of the read: only a state the backend still takes a press in keeps the URL's token. */
  it("opens a lapsed read and a stop link with the token and a void one without", () => {
    assert.deepEqual(startOf({ zustand: "abgelaufen" }, "abc123"), { zustand: "abgelaufen", token: "abc123" });
    assert.deepEqual(startOf({ zustand: "nicht_bestaetigbar" }, "abc123"), { zustand: "nicht_bestaetigbar", token: "abc123" });
    assert.deepEqual(startOf({ zustand: "wartezeit", gueltigBis: null, wirksamAb: "2026-10-28T12:30:00Z" }, "s"), {
      zustand: "wartezeit",
      gueltigBis: null,
      wirksamAb: "2026-10-28T12:30:00Z",
      token: "s",
    });
    assert.deepEqual(startOf({ zustand: "ungueltig" }, "abc123"), { zustand: "ungueltig" });
    assert.deepEqual(startOf({ zustand: "gesperrt" }, "abc123"), { zustand: "gesperrt" });
  });
});

describe("the stop side of an address page", () => {
  /* A stop hands nothing over, so it is offered in every state, as the decline is; no link approves anything. */
  for (const start of [
    STOPP,
    { zustand: "freigabe_offen", gueltigBis: "2026-10-21T11:30:00Z", wirksamAb: null, token: "stopp-1" },
    { zustand: "wartezeit", gueltigBis: null, wirksamAb: "2026-10-28T12:30:00Z", token: "stopp-1" },
  ] satisfies AdresswechselStart[]) {
    it(`offers the stop alone on a change ${start.zustand}, naming no address`, () => {
      render(h(AdresswechselLinkView, { route: ROUTE, start }));

      assert.deepEqual(
        screen.getAllByRole("button").map((button) => button.textContent.trim()),
        [ADRESSWECHSEL_STOPPEN],
      );
      assert.doesNotMatch(document.body.textContent, /@/);
    });
  }

  it("sends a change waiting on its approval to the account page, carrying no token", () => {
    render(
      h(AdresswechselLinkView, { route: ROUTE, start: { zustand: "freigabe_offen", gueltigBis: null, wirksamAb: null, token: "stopp-1" } }),
    );

    assert.equal(screen.getByRole("link", { name: "Zu Deinem Konto" }).getAttribute("href"), KONTO_HREF);
  });

  it("names the instant a waiting time ends", () => {
    assert.match(
      words({ zustand: "wartezeit", gueltigBis: null, wirksamAb: "2026-10-28T12:30:00Z", token: "stopp-1" }),
      /ab 28\. Oktober 2026 um 13:30 eine neue E-Mail-Adresse gelten/,
    );
  });

  it("posts the stop through the stop token and shows that the address stays", async () => {
    const { sent } = answerEveryFetch({ success: true, antwort: "gestoppt", wirksam_ab: null });

    render(h(AdresswechselLinkView, { route: ROUTE, start: STOPP }));
    await userEvent.setup().click(screen.getByRole("button", { name: ADRESSWECHSEL_STOPPEN }));
    await act(fetchMock.answered);

    await waitFor(() => assert.match(document.body.textContent, /Die neue Adresse ist entfernt, diese bleibt\./));
    assert.deepEqual(sent, [{ token: "stopp-1", antwort: "gestoppt" }]);
  });

  it("turns a stop link that died under the press into the void link's panel", async () => {
    answerEveryFetch({ success: false, zustand: "ungueltig" });

    render(h(AdresswechselLinkView, { route: ROUTE, start: STOPP }));
    await userEvent.setup().click(screen.getByRole("button", { name: ADRESSWECHSEL_STOPPEN }));
    await act(fetchMock.answered);

    await waitFor(() => assert.match(document.body.textContent, /Dieser Link ist ungültig/));
    assert.deepEqual(toasts, []);
  });
});

for (const [lane, Page] of [
  ["pupil", SpielerAdresswechselPage],
  ["referee", SchiedsrichterAdresswechselPage],
] as const) {
  /** What the page opens its view on, the link's read answered as the case set it. */
  const pageStart = async (): Promise<AdresswechselStart> =>
    (
      (await pageBody(Page as (props: NextPageProps) => ReactElement, {
        params: Promise.resolve({}),
        searchParams: Promise.resolve({ token: "kein-echtes-token" }),
      })) as ReactElement<{ start: AdresswechselStart }>
    ).props.start;

  describe(`the ${lane}'s address page over its read`, () => {
    it("opens the new mailbox's side and the stop side with the link's token", async () => {
      answerReadsWith(() => ({ acknowledged: 1, ansicht: { seite: "neu", zustand: "gueltig", gueltig_bis: "2026-10-21T11:30:00Z" } }));
      assert.deepEqual(await pageStart(), { zustand: "gueltig", gueltigBis: "2026-10-21T11:30:00Z", token: "kein-echtes-token" });

      answerReadsWith(() => ({
        acknowledged: 1,
        ansicht: { seite: "bisherig", zustand: "wartezeit", gueltig_bis: null, wirksam_ab: "2026-10-28T12:30:00Z" },
      }));
      assert.deepEqual(await pageStart(), {
        zustand: "wartezeit",
        gueltigBis: null,
        wirksamAb: "2026-10-28T12:30:00Z",
        token: "kein-echtes-token",
      });
    });

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
      assert.deepEqual(loggedErrorTraces(), [EDGE_TRACE_ID], "the line names no request");
    });

    /* An answer off its schema is a broken contract, never a failed read: the error boundary logs it. */
    it("lets a read off its contract reach the error boundary", async () => {
      answerReadsWith(() => ({ acknowledged: 1, ansicht: { seite: "neu", zustand: "verschollen", gueltig_bis: "2026-10-21T11:30:00Z" } }));

      await assert.rejects(pageStart(), { name: "APIMalformedDataError" });
    });
  });
}
