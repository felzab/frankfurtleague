import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { ADRESSWECHSEL_STOPPEN, JA_MEINE_ADRESSE, NICHT_MEINE_ADRESSE } from "@/core/adresswechselAntworten.ts";
import { KONTAKT_EMAIL } from "@/core/brand.ts";
import { KONTO_HREF } from "@/core/kontoHref.ts";
import { doubleLogger, doubleToasts, loggedErrorCodes, loggedErrorTraces } from "@/shared/testing/actionDoubles.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { answerReadsWith, backendUnreachable, EDGE_TRACE_ID, pageBody } from "@/shared/testing/pageHarness.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";
import { assertOwnPanel, resultPanels } from "@/shared/testing/resultPanels.ts";
import { LINK_ADRESSE_GESPERRT } from "@/shared/utils/reopenLink.ts";

import type { AdresswechselStart } from "@/features/adresswechsel/link.ts";
import type { NextPageProps } from "@/shared/types/types.ts";
import type { ReactElement } from "react";

const { raised: toasts } = doubleToasts();
const fetchMock = doubleFetch();
doubleLogger();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdresswechselLinkView } = await import("./AdresswechselLinkView.tsx");
const { startOf } = await import("@/features/adresswechsel/link.ts");
const { LinkUnlesbar } = await import("@/features/bewerbungen/components/views/BestaetigungPanels.tsx");
const { default: AdresswechselPage } = await import("@/app/(public)/bestaetigung/adresse/page.tsx");

const ROUTE = "/api/bestaetigung/adresse";

/** 13:30 in Berlin, so a page stating it in UTC would print another hour. */
const OFFEN: AdresswechselStart = { zustand: "gueltig", gueltigBis: "2026-10-21T11:30:00Z", weg: "konto", token: "abc123" };
const STOPP: AdresswechselStart = { zustand: "offen", gueltigBis: "2026-10-21T11:30:00Z", wirksamAb: null, weg: "konto", token: "stopp-1" };

const words = (start: AdresswechselStart): string =>
  textOf(renderTree(h(AdresswechselLinkView, { start })), " ")
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

/** A landed press, as the route handler answers one. */
const gedrueckt = (antwort: string, stand: { wirksam?: boolean; wirksam_ab?: string | null; genehmigung_offen?: boolean } = {}) => ({
  success: true,
  antwort: antwort,
  wirksam: stand.wirksam ?? false,
  wirksam_ab: stand.wirksam_ab ?? null,
  genehmigung_offen: stand.genehmigung_offen ?? false,
});

afterEach(() => {
  toasts.length = 0;
});

describe("the new mailbox's side of the address page", () => {
  it("offers the confirmation first and the decline after it, as the exit", () => {
    render(h(AdresswechselLinkView, { start: OFFEN }));

    assert.deepEqual(
      screen.getAllByRole("button").map((button) => button.textContent.trim()),
      [JA_MEINE_ADRESSE, NICHT_MEINE_ADRESSE],
    );
  });

  /* The change moves every record the address holds, so the page names no record; the deadline is an instant. */
  it("names no record, and states the deadline to the minute in Berlin", () => {
    const shown = words(OFFEN);

    assert.doesNotMatch(shown, /Spielerin|Schiedsrichter/);
    assert.match(shown, /Der Link gilt bis 21\. Oktober 2026 um 13:30 ?\./);
  });

  it("tells a change with a waiting time when it holds, and the person's own change nothing of one", () => {
    assert.match(words({ ...OFFEN, weg: "wartezeit" }), /Sie gilt eine Woche nach Deiner Bestätigung\./);
    assert.doesNotMatch(words(OFFEN), /eine Woche/);
  });

  /* An address already holding entries of its own is refused at the confirmation, so no open link promises them a join. */
  it("asks for the confirmation only of whoever asked for the change, and promises no join of entries", () => {
    assert.match(words(OFFEN), /Bestätige nur, wenn Du diese Änderung selbst angefragt hast\./);
    assert.doesNotMatch(words(OFFEN), /Einträge|einer Anmeldung/);
  });

  /* The decline outlives the deadline and the ban (`docs/frontend/spec.md :: I630`): the address goes whatever stands. */
  for (const zustand of ["abgelaufen", "nicht_bestaetigbar"] as const) {
    it(`offers the decline alone on a link ${zustand}, naming nobody`, () => {
      const shown = words({ zustand, weg: "konto", token: "abc123" });

      assert.ok(shown.includes(NICHT_MEINE_ADRESSE), "the decline is missing");
      assert.ok(!shown.includes(JA_MEINE_ADRESSE), "a closed link offers the confirmation");
    });
  }

  it("names neither a ban nor another pupil on a change it can no longer confirm", () => {
    assert.doesNotMatch(words({ zustand: "nicht_bestaetigbar", weg: "konto", token: "abc123" }), /gesperrt|Sperre|bisherige|andere/);
  });

  /* An account's move still owed, or entries the league removes, refuse the confirmation for a while only: the page claims
     no end, and offers the retry beside the league. */
  it("tells a change it cannot confirm now to try again later or write to the league, and claims no end", () => {
    render(h(AdresswechselLinkView, { start: { zustand: "nicht_bestaetigbar", weg: "konto", token: "abc123" } }));

    assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "Bestätigung gerade nicht möglich");
    assert.ok(
      document.body.textContent.includes(
        `Diese Änderung der E-Mail-Adresse kann gerade nicht bestätigt werden. Versuche es später erneut, oder schreib uns an ${KONTAKT_EMAIL}.`,
      ),
      document.body.textContent,
    );
    assert.doesNotMatch(document.body.textContent, /nicht mehr/);
  });

  /* Only the person's own start can be asked again on the account page; an administrator's needs the league. */
  it("sends a lapsed own change back to the account page, and an administrator's to the league", () => {
    assert.match(
      words({ zustand: "abgelaufen", weg: "konto", token: "abc123" }),
      /Ein Link gilt 24 Stunden\..*frag sie in Deinem Konto neu an/,
    );
    for (const weg of ["freigabe", "wartezeit"] as const) {
      const shown = words({ zustand: "abgelaufen", weg, token: "abc123" });
      assert.doesNotMatch(shown, /in Deinem Konto/, `a lapsed ${weg} change is sent to an account page that cannot start it`);
      assert.match(shown, /Brauchst Du die Änderung noch, schreib uns an/);
    }
  });

  /* A pressed link keeps answering: its holder learns what the change waits on, and a lost mailbox is never sent back to sign in. */
  it("says what a confirmed change still waits on, and where its holder signs in until then", () => {
    const bestaetigt = { zustand: "bestaetigt", wirksamAb: "2026-10-28T12:30:00Z", genehmigungOffen: false, weg: "konto" } as const;

    assert.match(
      words(bestaetigt),
      /gilt ab 28\. Oktober 2026 um 13:30 ?\..*Bis dahin meldest Du Dich mit der bisherigen an\..*Klappt die Anmeldung mit Deinem bisherigen Passkey nicht/,
    );
    assert.match(words({ ...bestaetigt, wirksamAb: null, genehmigungOffen: true }), /gilt, sobald die Verwaltung die Änderung genehmigt hat/);
    assert.match(words({ ...bestaetigt, genehmigungOffen: true }), /frühestens ab 28\. Oktober 2026 um 13:30 ?, und erst wenn die Verwaltung/);

    const wartezeit = words({ ...bestaetigt, weg: "wartezeit" });
    assert.doesNotMatch(wartezeit, /meldest Du Dich mit der bisherigen an/, "a lost mailbox's holder is sent back to it");
    assert.match(wartezeit, /Danach meldest Du Dich mit einem Code an die neue an\. Passkeys der bisherigen gelten dann nicht mehr/);
    assert.ok(
      !wartezeit.includes(JA_MEINE_ADRESSE) && !wartezeit.includes(NICHT_MEINE_ADRESSE),
      "a pressed link offers a press the backend refuses",
    );
  });

  /* Pressed, so the backend refuses the decline as well; and its link never lapsed, the approval's week did. */
  it("tells a confirmed change whose approval lapsed why it ends, offering no press", () => {
    render(h(AdresswechselLinkView, { start: { zustand: "genehmigung_abgelaufen", weg: "konto" } }));

    assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "Änderung abgelaufen");
    assert.deepEqual(
      screen.queryAllByRole("button").map((button) => button.textContent.trim()),
      [],
    );
    assert.match(
      document.body.textContent,
      /Die Änderung ist abgelaufen, weil die Verwaltung ihr nicht rechtzeitig zugestimmt hat\. Diese Adresse wird nicht übernommen\. Brauchst Du die Änderung noch, frag sie in Deinem Konto neu an\./,
    );
    assert.doesNotMatch(document.body.textContent, /Dieser Link ist abgelaufen|24 Stunden/);

    for (const weg of ["freigabe", "wartezeit"] as const) {
      const shown = words({ zustand: "genehmigung_abgelaufen", weg });
      assert.doesNotMatch(shown, /in Deinem Konto/, `a lapsed ${weg} change is sent to an account page that cannot start it`);
      assert.match(shown, /Brauchst Du die Änderung noch, schreib uns an/);
    }
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
      [{ zustand: "abgelaufen", weg: "konto", token: "abc123" }, "Dieser Link ist abgelaufen."],
      [{ zustand: "nicht_bestaetigbar", weg: "konto", token: "abc123" }, "kann gerade nicht bestätigt werden."],
      [{ zustand: "bestaetigt", wirksamAb: null, genehmigungOffen: true, weg: "konto" }, "sobald die Verwaltung die Änderung genehmigt hat."],
      [{ zustand: "genehmigung_abgelaufen", weg: "konto" }, "weil die Verwaltung ihr nicht rechtzeitig zugestimmt hat."],
      [{ zustand: "beendet", seite: "bisherig", art: "wirksam" }, "Für das Konto gilt inzwischen eine neue E-Mail-Adresse."],
      [{ zustand: "ungueltig" }, "Zu diesem Link finden wir keine Änderung."],
      [{ zustand: "gesperrt" }, LINK_ADRESSE_GESPERRT],
      [{ zustand: "unlesbar" }, unlesbar],
    ] satisfies [AdresswechselStart, string | null][]) {
      assertOwnPanel(renderTree(h(AdresswechselLinkView, { start })), eigenes, start.zustand);
    }
  });

  for (const [gedrueckteTaste, antwort, ergebnis] of [
    [
      JA_MEINE_ADRESSE,
      gedrueckt("bestaetigt", { wirksam: true }),
      /Die neue E-Mail-Adresse gilt jetzt\. Melde Dich mit ihr neu an\..*Passkey/s,
    ],
    // A change an administrator started with a reason takes effect only once its waiting time ends.
    [JA_MEINE_ADRESSE, gedrueckt("bestaetigt", { wirksam_ab: "2026-10-28T12:30:00Z" }), /gilt ab 28\. Oktober 2026 um 13:30\./],
    [NICHT_MEINE_ADRESSE, gedrueckt("abgelehnt"), /Diese Adresse ist aus der Änderung entfernt und wird nicht übernommen\./],
  ] as const) {
    it(`posts „${gedrueckteTaste}“ as ${antwort.antwort} to the one route and shows its result`, async () => {
      const { sent, urls } = answerEveryFetch(antwort);

      render(h(AdresswechselLinkView, { start: OFFEN }));
      await userEvent.setup().click(screen.getByRole("button", { name: gedrueckteTaste }));
      await act(fetchMock.answered);

      await waitFor(() => assert.match(document.body.textContent, ergebnis));
      assert.deepEqual(sent, [{ token: "abc123", antwort: antwort.antwort }]);
      assert.deepEqual(urls, [ROUTE]);
    });
  }

  /* The link closed between the open and the press: its panel replaces the answers, never a toast, and the decline stays on
     offer with the token, or the route refuses it as a link opened without one (`docs/frontend/spec.md :: I630`). */
  for (const [zustand, panel] of [
    ["abgelaufen", /Dieser Link ist abgelaufen/],
    ["nicht_bestaetigbar", /kann gerade nicht bestätigt werden/],
  ] as const) {
    it(`turns a link ${zustand} under the press into that panel, keeping the token for the decline`, async () => {
      const { sent } = answerEveryFetch({ success: false, zustand });

      render(h(AdresswechselLinkView, { start: OFFEN }));
      const user = userEvent.setup();
      await user.click(screen.getByRole("button", { name: JA_MEINE_ADRESSE }));
      await act(fetchMock.answered);
      await waitFor(() => assert.match(document.body.textContent, panel));
      assert.equal(screen.queryAllByRole("button", { name: JA_MEINE_ADRESSE }).length, 0);
      assert.deepEqual(toasts, []);

      await user.click(screen.getByRole("button", { name: NICHT_MEINE_ADRESSE }));
      await act(fetchMock.answered);

      assert.deepEqual(sent, [
        { token: "abc123", antwort: "bestaetigt" },
        { token: "abc123", antwort: "abgelehnt" },
      ]);
    });
  }

  /* The decline unmounts from under its press as the first answer's did, so its result takes the focus as well. */
  it("hands the focus to the result of a second answer, as to the first", async () => {
    const antworten = [{ success: false, zustand: "abgelaufen" }, gedrueckt("abgelehnt")];
    fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(antworten.shift()), { status: 200 })));

    render(h(AdresswechselLinkView, { start: OFFEN }));
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: JA_MEINE_ADRESSE }));
    await act(fetchMock.answered);
    await waitFor(() => assert.match(document.body.textContent, /Dieser Link ist abgelaufen/));

    await user.click(screen.getByRole("button", { name: NICHT_MEINE_ADRESSE }));
    await act(fetchMock.answered);

    await waitFor(() => assert.match(document.body.textContent, /Diese Adresse ist aus der Änderung entfernt/));
    const ergebnis = screen.getByRole("status");
    assert.ok(document.activeElement === ergebnis, `the focus is on <${document.activeElement?.tagName.toLowerCase() ?? "none"}>`);
  });

  /* A refusal the handler words is the toast's sentence: the generic one would hide what the page can tell its holder. */
  it("says a refused press's own sentence, never the generic one", async () => {
    const satz = "Diese Adresse lässt sich gerade nicht bestätigen. Öffne den Link später noch einmal.";
    answerEveryFetch({ success: false, error: satz });

    render(h(AdresswechselLinkView, { start: OFFEN }));
    await userEvent.setup().click(screen.getByRole("button", { name: JA_MEINE_ADRESSE }));
    await act(fetchMock.answered);

    await waitFor(() => assert.equal(toasts.length, 1));
    assert.equal(toasts[0]?.description, satz);
  });

  /* A change that ended under the press is read again by the handler, so the page says how it ended rather than calling it void. */
  it("shows how a change that ended under the press ended, from the handler's read", async () => {
    answerEveryFetch({ success: false, ansicht: { zustand: "beendet", seite: "neu", art: "ersetzt" } });

    render(h(AdresswechselLinkView, { start: OFFEN }));
    await userEvent.setup().click(screen.getByRole("button", { name: JA_MEINE_ADRESSE }));
    await act(fetchMock.answered);

    await waitFor(() => assert.match(document.body.textContent, /durch eine neuere ersetzt/));
    assert.deepEqual(toasts, []);
  });

  /* The page's own reading of the read: only a state the backend still takes a press in keeps the URL's token. */
  it("opens a lapsed read and a stop link with the token, and a pressed or ended one without", () => {
    assert.deepEqual(startOf({ zustand: "abgelaufen", weg: "konto" }, "abc123"), { zustand: "abgelaufen", weg: "konto", token: "abc123" });
    assert.deepEqual(startOf({ zustand: "wartezeit", gueltigBis: null, wirksamAb: "2026-10-28T12:30:00Z", weg: "wartezeit" }, "s"), {
      zustand: "wartezeit",
      gueltigBis: null,
      wirksamAb: "2026-10-28T12:30:00Z",
      weg: "wartezeit",
      token: "s",
    });
    for (const ohne of [
      { zustand: "ungueltig" },
      { zustand: "gesperrt" },
      { zustand: "beendet", seite: "neu", art: "wirksam" },
      { zustand: "bestaetigt", wirksamAb: null, genehmigungOffen: true, weg: "konto" },
      { zustand: "genehmigung_abgelaufen", weg: "konto" },
    ] as const) {
      assert.ok(!("token" in startOf(ohne, "abc123")), `${ohne.zustand} kept a token no press may spend`);
    }
  });
});

describe("the stop side of the address page", () => {
  /* A stop hands nothing over, so it is offered in every live state, as the decline is; no link approves anything. */
  for (const start of [
    STOPP,
    { zustand: "freigabe_offen", gueltigBis: "2026-10-21T11:30:00Z", wirksamAb: null, weg: "freigabe", token: "stopp-1" },
    { zustand: "genehmigung", gueltigBis: null, wirksamAb: null, weg: "konto", token: "stopp-1" },
    { zustand: "wartezeit", gueltigBis: null, wirksamAb: "2026-10-28T12:30:00Z", weg: "wartezeit", token: "stopp-1" },
  ] satisfies AdresswechselStart[]) {
    it(`offers the stop alone on a change ${start.zustand}, naming no address`, () => {
      render(h(AdresswechselLinkView, { start }));

      assert.deepEqual(
        screen.getAllByRole("button").map((button) => button.textContent.trim()),
        [ADRESSWECHSEL_STOPPEN],
      );
      assert.doesNotMatch(document.body.textContent, /@/);
    });
  }

  it("sends a change waiting on its approval to the account page, carrying no token, and asks a check first", () => {
    const start = { zustand: "freigabe_offen", gueltigBis: null, wirksamAb: null, weg: "freigabe", token: "stopp-1" } as const;
    render(h(AdresswechselLinkView, { start }));

    assert.equal(screen.getByRole("link", { name: "Zu Deinem Konto" }).getAttribute("href"), KONTO_HREF);
    assert.match(words(start), /Gib sie nur frei, wenn Du das selbst angefragt hast/);
  });

  /* A change made because the mailbox is lost is never said to hold at its confirmation. */
  it("tells an unconfirmed change with a waiting time that it holds a week after its confirmation", () => {
    assert.match(
      words({ zustand: "offen", gueltigBis: null, wirksamAb: null, weg: "wartezeit", token: "stopp-1" }),
      /gilt sie eine Woche danach/,
    );
    assert.match(words(STOPP), /sobald sie bestätigt ist/);
  });

  it("names the instant a waiting time ends", () => {
    assert.match(
      words({ zustand: "wartezeit", gueltigBis: null, wirksamAb: "2026-10-28T12:30:00Z", weg: "wartezeit", token: "stopp-1" }),
      /ab 28\. Oktober 2026 um 13:30 eine neue E-Mail-Adresse gelten/,
    );
  });

  it("says a change waiting on an administrator's approval still signs in with this address", () => {
    assert.match(
      words({ zustand: "genehmigung", gueltigBis: null, wirksamAb: null, weg: "konto", token: "stopp-1" }),
      /Sie gilt erst, wenn die Verwaltung die Änderung genehmigt hat\. Bis dahin meldest Du Dich weiter mit dieser Adresse an/,
    );
  });

  it("posts the stop through the stop token and shows that the address stays", async () => {
    const { sent } = answerEveryFetch(gedrueckt("gestoppt"));

    render(h(AdresswechselLinkView, { start: STOPP }));
    await userEvent.setup().click(screen.getByRole("button", { name: ADRESSWECHSEL_STOPPEN }));
    await act(fetchMock.answered);

    await waitFor(() => assert.match(document.body.textContent, /Die neue Adresse ist entfernt, diese bleibt\./));
    assert.deepEqual(sent, [{ token: "stopp-1", antwort: "gestoppt" }]);
  });

  /* The visit a takeover's victim makes: a change that took effect is said to have, never that the address still holds. */
  it("tells the holder of a stop link whose change took effect that it did, and how to repudiate it", () => {
    const shown = words({ zustand: "beendet", seite: "bisherig", art: "wirksam" });

    assert.match(shown, /Für das Konto gilt inzwischen eine neue E-Mail-Adresse\. Hast Du das nicht veranlasst\? Schreib uns sofort an/);
    assert.doesNotMatch(shown, /gilt die bisherige weiter|bleibt/);
    assert.ok(!shown.includes(ADRESSWECHSEL_STOPPEN), "a change that took effect offers a stop");
  });

  /* Every way a change ends reads true from either side, the address on file told it stays only where it does. */
  for (const art of ["abgelehnt", "gestoppt", "abgelaufen", "ersetzt", "verworfen"] as const) {
    it(`says from the stop side that a change ${art} leaves the address in force or names its successor`, () => {
      assert.match(words({ zustand: "beendet", seite: "bisherig", art }), /Diese Adresse bleibt|diese bleibt|eigenen Hinweis/);
    });
  }

  /* The account did not change, so the stop's way out is for whoever never asked for the change. */
  it("sends the address on file to the league after a stop where it never asked for the change", () => {
    const shown = words({ zustand: "beendet", seite: "bisherig", art: "gestoppt" });

    assert.match(shown, /Hast Du die Änderung nicht selbst angefragt, schreib uns/);
    assert.doesNotMatch(shown, /geändert, schreib/);
  });

  /* A newer change waiting on the address on file's approval has mailed the new address nothing yet. */
  it("promises the new mailbox no newer mail where a change was replaced", () => {
    assert.match(words({ zustand: "beendet", seite: "neu", art: "ersetzt" }), /nimm nur einen Link aus einer späteren E-Mail\./);
  });

  it("turns a stop link that matches nothing under the press into the void link's panel", async () => {
    answerEveryFetch({ success: false, zustand: "ungueltig" });

    render(h(AdresswechselLinkView, { start: STOPP }));
    await userEvent.setup().click(screen.getByRole("button", { name: ADRESSWECHSEL_STOPPEN }));
    await act(fetchMock.answered);

    await waitFor(() => assert.match(document.body.textContent, /Zu diesem Link finden wir keine Änderung/));
    assert.deepEqual(toasts, []);
  });
});

/** What the page opens its view on, the link's read answered as the case set it. */
const pageStart = async (): Promise<AdresswechselStart> =>
  (
    (await pageBody(AdresswechselPage as (props: NextPageProps) => ReactElement, {
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ token: "kein-echtes-token" }),
    })) as ReactElement<{ start: AdresswechselStart }>
  ).props.start;

describe("the address page over its read", () => {
  it("opens the new mailbox's side and the stop side with the link's token, and an ended change without", async () => {
    answerReadsWith(() => ({
      acknowledged: 1,
      ansicht: {
        seite: "neu",
        zustand: "gueltig",
        gueltig_bis: "2026-10-21T11:30:00Z",
        wirksam_ab: null,
        weg: "konto",
        genehmigung_offen: false,
      },
    }));
    assert.deepEqual(await pageStart(), { zustand: "gueltig", gueltigBis: "2026-10-21T11:30:00Z", weg: "konto", token: "kein-echtes-token" });

    answerReadsWith(() => ({
      acknowledged: 1,
      ansicht: { seite: "bisherig", zustand: "wartezeit", gueltig_bis: null, wirksam_ab: "2026-10-28T12:30:00Z", weg: "wartezeit" },
    }));
    assert.deepEqual(await pageStart(), {
      zustand: "wartezeit",
      gueltigBis: null,
      wirksamAb: "2026-10-28T12:30:00Z",
      weg: "wartezeit",
      token: "kein-echtes-token",
    });

    answerReadsWith(() => ({ acknowledged: 1, ansicht: { seite: "bisherig", zustand: "beendet", art: "wirksam" } }));
    assert.deepEqual(await pageStart(), { zustand: "beendet", seite: "bisherig", art: "wirksam" });
  });

  /* Pressed, so its own state and no token: the read's `abgelaufen` keeps one for the decline an unpressed link still takes. */
  it("opens a pressed link whose approval lapsed on its own state, without the token", async () => {
    answerReadsWith(() => ({
      acknowledged: 1,
      ansicht: { seite: "neu", zustand: "genehmigung_abgelaufen", gueltig_bis: null, wirksam_ab: null, weg: "konto", genehmigung_offen: null },
    }));

    assert.deepEqual(await pageStart(), { zustand: "genehmigung_abgelaufen", weg: "konto" });
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
