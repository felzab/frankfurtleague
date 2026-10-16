import "@/shared/testing/dom.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleSendMail } from "@/core/mailDouble.ts";
import { doubleActionRequest, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { answersInFlight } from "@/shared/testing/answersInFlight.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answer, answerReadsWith, EMPTIEST_ANSWER, OBJECT_ID, renderPage, resolvedPage } from "@/shared/testing/pageHarness.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

doubleActionRequest();
doubleSendMail();
const { raised: toasts } = doubleToasts();

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: AdminSperrlistePage } = await import("@/app/bereich/admin/sperrliste/page.tsx");
const { SPERRE_ANSICHT_COPY } = await import("./constants.ts");
const { IN_NEUEM_TAB } = await import("@/shared/components/ui/NewTabLink.tsx");

/** The one ban the list read answers, every other read the emptiest body its schema takes. */
const EINTRAG = {
  id: OBJECT_ID,
  grund: "Fremde Namen eingetragen",
  erstellt_von: "vorstand@example.org",
  erstellt_von_gesperrt: false,
  erstellt_am: "2026-03-01",
  gesperrt_bis_saison_id: "2030",
};

/** The list's read and the create share the path, each schema taking the fields it names. */
const SPERRLISTE = { sperrliste: [EINTRAG], anzahl_gesamt: 1, acknowledged: 1, created_id: OBJECT_ID, gesperrt_bis_saison_id: "2031" };

const ANSICHT_ENDPOINT = "/identitaet/erasure/ansicht";

const TEAM = "6890a1b2c3d4e5f607250011";
const SPIELER = "6890a1b2c3d4e5f607250012";
const SCHIEDSRICHTER = "6890a1b2c3d4e5f607250013";
const BEWERBUNG = "6890a1b2c3d4e5f607250014";
const WECHSELNDER_SCHIEDSRICHTER = "6890a1b2c3d4e5f607250016";
const WECHSELNDER_SPIELER = "6890a1b2c3d4e5f607250017";

const PERSON = { vorname: "Zorbanax", nachname: "Quell" };
const NICHTS = {
  spieler: [],
  schiedsrichter: [],
  sitze: [],
  bewerbungen: [],
  registrierungen: [],
  adresswechsel: [],
  spieler_adresswechsel: [],
};

/**
 * A record of every kind the reveal serves, a pupil's two squad rows among them, every season a record names other
 * than the shell's: a link carrying the shell's season where it owes its record's reads wrong.
 */
const BESTAND = {
  ...NICHTS,
  spieler: [
    {
      spieler_id: SPIELER,
      ...PERSON,
      kader: [
        { saison_id: "2024", team_id: TEAM, team_name: "Goethe-Gymnasium", inactive_since: null },
        { saison_id: "2026", team_id: TEAM, team_name: "Goethe-Gymnasium", inactive_since: null },
      ],
    },
  ],
  schiedsrichter: [
    { schiedsrichter_id: SCHIEDSRICHTER, name: "Zorbanax Quell", inactive_since: null, spiele_ohne_ergebnis_saison_ids: ["2024", "2026"] },
  ],
  sitze: [{ team_id: TEAM, saison_id: "2026", team_name: "Goethe-Gymnasium", rolle: "trainer", ...PERSON }],
  bewerbungen: [{ bewerbung_id: BEWERBUNG, saison_id: "2027", rolle: "ansprechperson", ...PERSON }],
  registrierungen: [
    { registrierung_id: "6890a1b2c3d4e5f607250015", team_id: TEAM, saison_id: "2026", team_name: null, status: "eingereicht", ...PERSON },
  ],
  adresswechsel: [{ schiedsrichter_id: WECHSELNDER_SCHIEDSRICHTER }],
  spieler_adresswechsel: [{ spieler_id: WECHSELNDER_SPIELER }],
};

/** What the read of the barred address answers in the case at hand. */
let antwort: () => Promise<Record<string, unknown>> = () => Promise.resolve(BESTAND);
beforeEach(() => {
  antwort = () => Promise.resolve(BESTAND);
  toasts.length = 0;
});

// Tracked, so a case awaits the press's answers before it polls the page (`docs/frontend/spec.md` §1.9).
const { track, answered } = answersInFlight();
answerReadsWith((endpoint, schema, params) =>
  track(
    endpoint,
    endpoint === ANSICHT_ENDPOINT
      ? antwort().then((records) => answer(schema, endpoint, { ...records, acknowledged: 1, verwaltung: null }))
      : Promise.resolve(endpoint === "/sperrliste" ? answer(schema, endpoint, SPERRLISTE) : EMPTIEST_ANSWER(endpoint, schema, params)),
  ),
);

/** The page at its own address. */
const PAGE = underNext(h(AdminSperrlistePage, {}), { pathname: "/bereich/admin/sperrliste" });

const BARRED = "zorbanax@beispielschule.de";

/** The page under the season `2025` the shell shows, a ban of `BARRED` pressed through its dialog: the dialog once the press has landed. */
async function sperren(): Promise<HTMLElement> {
  const user = userEvent.setup();
  render(
    underNext(await resolvedPage(AdminSperrlistePage, {}), {
      pathname: "/bereich/admin/sperrliste",
      search: "saison_id=2025",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Adresse sperren" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByRole("textbox", { name: /E-Mail/ }), BARRED);
  await user.type(within(dialog).getByRole("textbox", { name: /Grund/ }), "Falsches Geburtsdatum angegeben");
  await user.click(within(dialog).getByRole("button", { name: "Speichern" }));
  await act(answered);
  await within(dialog).findByText(SPERRE_ANSICHT_COPY.heading);

  return dialog;
}

/**
 * Every link the dialog offers, as its label and the address it opens, each held to a tab of its own: a link
 * navigating the dialog's tab takes every record after it off the screen for good.
 */
const verweiseIn = (dialog: HTMLElement): [string, string | null][] =>
  within(dialog)
    .queryAllByRole("link")
    .map((link) => {
      const text = link.textContent ?? "";
      assert.ok(text.endsWith(` ${IN_NEUEM_TAB}`), `„${text}“ never says it opens a new tab`);
      assert.equal(link.getAttribute("target"), "_blank", `„${text}“ opens in the dialog's own tab`);
      assert.equal(link.getAttribute("rel"), "noopener noreferrer", `„${text}“ hands the opened page a handle on the dialog`);
      return [text.slice(0, -` ${IN_NEUEM_TAB}`.length), link.getAttribute("href")];
    });

// Ahead of every server render in this file: React's server renderer marks each context it provides and never
// clears the mark, so a client render after it warns once per provider rendered.
describe("what the ban's dialog shows once the ban stands (`docs/frontend/spec.md :: I688`)", () => {
  /* The list is the administrator's whole to-do: a record it drops, or a link opening a season the record is not
     in, leaves that record in place unnoticed, and nobody holds the address once the dialog closes. */
  it("links every record the address holds to its tool, at the record's own season", async () => {
    const dialog = await sperren();

    assert.ok(screen.queryByRole("dialog") === dialog, "the dialog closed over the list");
    // The registration's own sentence beside it: the lead's promise of an edit reaches no registration.
    assert.ok(
      within(dialog).queryByText(`${SPERRE_ANSICHT_COPY.lead} ${SPERRE_ANSICHT_COPY.registrierungen}`) !== null,
      "the list stands under no lead, or one promising an edit of a registration",
    );
    assert.deepEqual(verweiseIn(dialog), [
      ["Kadereintrag austragen", `/bereich/admin/spieler/${SPIELER}?saison_id=2024`],
      ["Kadereintrag austragen", `/bereich/admin/spieler/${SPIELER}?saison_id=2026`],
      // The fixtures first, each season's at that season: `REQ-RETIRE-004` refuses to retire a referee still booked on
      // one in any season, and the search reads one at a time.
      ["Spiele der Saison 2024 neu besetzen", `/bereich/admin/spielsuche?schiedsrichter=${SCHIEDSRICHTER}&saison_id=2024`],
      ["Spiele der Saison 2026 neu besetzen", `/bereich/admin/spielsuche?schiedsrichter=${SCHIEDSRICHTER}&saison_id=2026`],
      ["Schiedsrichter stilllegen", `/bereich/admin/schiedsrichter/${SCHIEDSRICHTER}?saison_id=2025`],
      ["Kontakte bearbeiten", `/bereich/admin/kontakte/${TEAM}?saison_id=2026`],
      ["Bewerbung öffnen", `/bereich/admin/bewerbungen/${BEWERBUNG}?saison_id=2025`],
      ["Registrierungen ansehen", "/bereich/admin/registrierungen?saison_id=2025"],
      ["Adressänderung ansehen", `/bereich/admin/schiedsrichter/${WECHSELNDER_SCHIEDSRICHTER}?saison_id=2025`],
      ["Adressänderung ansehen", `/bereich/admin/spieler/${WECHSELNDER_SPIELER}?saison_id=2025`],
    ]);
    for (const [, href] of verweiseIn(dialog)) assert.ok(href !== null && !href.includes("@"), `${String(href)} carries an address`);
  });

  /* The registrations list serves the pending ones alone: a link to a declined one opens a list it is not on. */
  it("links no declined registration, and names it declined", async () => {
    antwort = () =>
      Promise.resolve({
        ...NICHTS,
        registrierungen: [
          { registrierung_id: "6890a1b2c3d4e5f607250015", team_id: TEAM, saison_id: "2026", team_name: null, status: "abgelehnt", ...PERSON },
        ],
      });

    const dialog = await sperren();

    assert.deepEqual(verweiseIn(dialog), []);
    assert.ok(
      within(dialog).queryByText(/^Abgelehnte Registrierung für die Saison 2026: Zorbanax Quell$/) !== null,
      "the line hides its status",
    );
  });

  /* The memberships read lists a pupil holding no squad row, and the editor opens on them: their record is what stands. */
  it("links a pupil holding no squad row to their record", async () => {
    antwort = () => Promise.resolve({ ...NICHTS, spieler: [{ spieler_id: SPIELER, ...PERSON, kader: [] }] });

    const dialog = await sperren();

    assert.deepEqual(verweiseIn(dialog), [["Eintrag ansehen", `/bereich/admin/spieler/${SPIELER}?saison_id=2025`]]);
  });

  /* A row taken out and a referee retired have nothing left to take out: their editors offer no austragen and no
     retirement, so a link promising one opens a page without it. */
  it("offers no austragen of a squad row taken out and no retirement of a referee retired, linking their records", async () => {
    antwort = () =>
      Promise.resolve({
        ...NICHTS,
        spieler: [
          {
            spieler_id: SPIELER,
            ...PERSON,
            kader: [
              { saison_id: "2024", team_id: TEAM, team_name: "Goethe-Gymnasium", inactive_since: "2025-02-01" },
              { saison_id: "2026", team_id: TEAM, team_name: "Goethe-Gymnasium", inactive_since: null },
            ],
          },
        ],
        schiedsrichter: [
          { schiedsrichter_id: SCHIEDSRICHTER, name: "Zorbanax Quell", inactive_since: "2025-03-01", spiele_ohne_ergebnis_saison_ids: [] },
        ],
      });

    const dialog = await sperren();

    // No fixtures link either: the referee holds no booking still to be played.
    assert.deepEqual(verweiseIn(dialog), [
      ["Eintrag ansehen", `/bereich/admin/spieler/${SPIELER}?saison_id=2024`],
      ["Kadereintrag austragen", `/bereich/admin/spieler/${SPIELER}?saison_id=2026`],
      ["Eintrag ansehen", `/bereich/admin/schiedsrichter/${SCHIEDSRICHTER}?saison_id=2025`],
    ]);
    assert.ok(within(dialog).queryByText(/\(2024\), ausgetragen seit 01\.02\.2025$/) !== null, "the row taken out reads as one still in");
    assert.ok(within(dialog).queryByText(/Zorbanax Quell, stillgelegt seit 01\.03\.2025$/) !== null, "the retired referee reads as active");
  });

  /* Opened again, the dialog is the next ban's form: a list left standing would name the last address's records. */
  it("says the address holds nothing where it holds nothing, and closes on „Fertig“ to open on the form again", async () => {
    antwort = () => Promise.resolve(NICHTS);
    const user = userEvent.setup();

    const dialog = await sperren();

    assert.ok(within(dialog).queryByText(SPERRE_ANSICHT_COPY.leer) !== null, "an empty answer reads as something else");
    assert.deepEqual(verweiseIn(dialog), []);
    await user.click(within(dialog).getByRole("button", { name: SPERRE_ANSICHT_COPY.fertig }));
    await waitFor(() => assert.ok(screen.queryByRole("dialog") === null, "„Fertig“ left the dialog open"));

    await user.click(screen.getByRole("button", { name: "Adresse sperren" }));
    const reopened = await screen.findByRole("dialog");
    assert.ok(within(reopened).queryByRole("textbox", { name: /E-Mail/ }) !== null, "the dialog opened on the last ban's list");
    assert.ok(within(reopened).queryByText(SPERRE_ANSICHT_COPY.heading) === null, "the last ban's list stood over the form");
  });

  /* The ban was written before the read, and the address survives nowhere to read again with. */
  it("says the list could not be read and that the ban stands where the read failed", async () => {
    antwort = () => Promise.reject(new Error("the backend answered nothing"));

    const dialog = await sperren();

    assert.ok(within(dialog).queryByText(SPERRE_ANSICHT_COPY.nichtGeladen) !== null, "the failed read reads as an empty list");
    assert.deepEqual(
      toasts.map(({ variant, title }) => [variant, title]),
      [["success", "Adresse gesperrt"]],
      "the ban was answered as anything but saved",
    );
  });
});

describe("the page the ban list stands on", () => {
  /* One `h1` per page and the admin shell owns it (`.claude/rules/frontend.md`), so what this page
     may raise is none. */
  it("raises no heading the shell already owns", async () => {
    const markup = await renderPage(PAGE);

    // The control: a page rendering no row at all would satisfy the absence below unread.
    assert.ok(markup.includes(EINTRAG.grund), "the list renders no ban, so the absence below proves nothing");
    assert.ok(!markup.includes("<h1"), "the page raises an h1 the shell already owns");
  });

  /* A reason is typed by an administrator and may quote an address or a link, one word wider than the
     card on a phone: its line breaks that word rather than run it past the card. */
  it("breaks a word of the reason wider than its card", async () => {
    const markup = await renderPage(PAGE);
    const zeile = new RegExp(`<p class="([^"]*)">${EINTRAG.grund}</p>`).exec(markup)?.[1]?.split(" ");

    assert.ok(zeile !== undefined, "the reason renders in no line of its own, so the case below reads nothing");
    assert.ok(zeile.includes("wrap-break-word"), "a long word of the reason runs past the card");
  });

  /* The page's chrome may never wait on the list: rendered with no boundary awaited, the bar stands
     beside the list's fallback, where an async page would suspend whole. */
  it("renders its chrome before the list resolves", () => {
    const markup = renderTree(PAGE);

    assert.ok(markup.includes('role="status"'), "no fallback stands where the list will resolve");
    assert.ok(markup.includes('type="search"'), "the page's bar waits on the list");
  });
});
