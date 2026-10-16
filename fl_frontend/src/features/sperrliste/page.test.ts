import "@/shared/testing/dom.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";
import { doubleActionRequest, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { answersInFlight } from "@/shared/testing/answersInFlight.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import {
  answer,
  answerReadsWith,
  clearSteps,
  EMPTIEST_ANSWER,
  OBJECT_ID,
  renderPage,
  resolvedPage,
  steps,
} from "@/shared/testing/pageHarness.ts";
import { refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { UserEvent } from "@testing-library/user-event";
import type { TestContext } from "node:test";

doubleActionRequest();
doubleSendMail();
const { raised: toasts } = doubleToasts();
// The origin the ban's notice links from: without one the notice fails to build, and the ban's toast is its warning.
registerDoubles({
  modules: { "core/config.ts": { frontend_config: { AUTH_URL: "http://localhost:3000", LOG_LEVEL: "ERROR", LOG_FORMAT: "json" } } },
});

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: AdminSperrlistePage } = await import("@/app/bereich/admin/sperrliste/page.tsx");
const { SPERRE_ANSICHT_COPY, SPERRE_ERFOLG, SPERRE_PRESS } = await import("./constants.ts");
const { mapSperreRefusal } = await import("./refusals.ts");
const { IN_NEUEM_TAB } = await import("@/shared/components/ui/NewTabLink.tsx");
const { BLOCKED_SUBMIT_TITLE } = await import("@/shared/hooks/useDraftFieldErrors.ts");

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
const CREATE_OPERATION = "POST /sperrliste";

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

/** What the read of the address answers in the case at hand, its grant's field among the records. */
let antwort: () => Promise<Record<string, unknown>> = () => Promise.resolve(BESTAND);
/** What the ban's write answers in the case at hand. */
let sperre: () => Promise<Record<string, unknown>> = () => Promise.resolve(SPERRLISTE);
beforeEach(() => {
  antwort = () => Promise.resolve(BESTAND);
  sperre = () => Promise.resolve(SPERRLISTE);
  toasts.length = 0;
  clearSteps();
});

// Tracked, so a case awaits the press's answers before it polls the page (`docs/frontend/spec.md` §1.9).
const { track, answered } = answersInFlight();
answerReadsWith((endpoint, schema, params) => {
  // The ban is the one call on its path carrying a body; the step is the call's own while this answer is asked for.
  const schritt = steps.at(-1);
  const istSperre = endpoint === "/sperrliste" && schritt?.kind === "read" && schritt.body !== undefined;

  return track(
    endpoint,
    endpoint === ANSICHT_ENDPOINT
      ? antwort().then((records) => answer(schema, endpoint, { verwaltung: null, gesperrt: false, ...records, acknowledged: 1 }))
      : istSperre
        ? sperre().then((fields) => answer(schema, endpoint, fields))
        : Promise.resolve(endpoint === "/sperrliste" ? answer(schema, endpoint, SPERRLISTE) : EMPTIEST_ANSWER(endpoint, schema, params)),
  );
});

/** The page at its own address. */
const PAGE = underNext(h(AdminSperrlistePage, {}), { pathname: "/bereich/admin/sperrliste" });

const BARRED = "zorbanax@beispielschule.de";
const ANDERE = "quell@beispielschule.de";
const GRUND = "Falsches Geburtsdatum angegeben";

/** The bodies each endpoint was sent, in order: a ban's and a read's alike name the address they were made for. */
const gesendet = (endpoint: string): unknown[] =>
  steps.flatMap((step) => (step.kind === "read" && step.endpoint === endpoint && step.body !== undefined ? [step.body] : []));

/** The page under the season `2025` the shell shows, its dialog open with both boxes typed. */
async function oeffnen(email = BARRED): Promise<{ dialog: HTMLElement; user: UserEvent }> {
  const user = userEvent.setup();
  render(
    underNext(await resolvedPage(AdminSperrlistePage, {}), {
      pathname: "/bereich/admin/sperrliste",
      search: "saison_id=2025",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Adresse sperren" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByRole("textbox", { name: /E-Mail/ }), email);
  await user.type(within(dialog).getByRole("textbox", { name: /Grund/ }), GRUND);

  return { dialog, user };
}

/** The dialog's first press, its read answered: the reveal armed over whatever the read left it. */
async function zeigen(dialog: HTMLElement, user: UserEvent): Promise<void> {
  await user.click(within(dialog).getByRole("button", { name: SPERRE_PRESS.resting }));
  await act(answered);
}

/** The dialog opened, typed and armed over the list it read. */
async function gezeigt(email = BARRED): Promise<{ dialog: HTMLElement; user: UserEvent }> {
  const opened = await oeffnen(email);
  await zeigen(opened.dialog, opened.user);
  await within(opened.dialog).findByText(SPERRE_ANSICHT_COPY.heading);

  return opened;
}

/** The armed press, past the double press's window, and the ban's answers awaited. */
async function sperren(dialog: HTMLElement, user: UserEvent, t: TestContext): Promise<void> {
  t.mock.timers.tick(DOUBLE_PRESS_MS);
  await user.click(within(dialog).getByRole("button", { name: SPERRE_PRESS.armed }));
  await act(answered);
}

/**
 * Every link the dialog offers, as its label and the address it opens, each held to a tab of its own: a link
 * navigating the dialog's tab takes the list and the typed address off the screen for good.
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

/** The dialog's boxes marked invalid, by their labels. */
const markiert = (dialog: HTMLElement): string[] =>
  within(dialog)
    .getAllByRole("textbox")
    .filter((box) => box.getAttribute("aria-invalid") === "true")
    .map((box) => (box as HTMLInputElement).labels?.[0]?.textContent?.trim() ?? "");

// Ahead of every server render in this file: React's server renderer marks each context it provides and never
// clears the mark, so a client render after it warns once per provider rendered.
describe("what the ban's dialog shows before the ban (`docs/frontend/spec.md :: I688`)", () => {
  /* The list is the administrator's whole to-do: a record it drops, or a link opening a season the record is not
     in, leaves that record in place unnoticed, and nobody holds the address once the dialog closes. */
  it("links every record the address holds to its tool, at the record's own season", async () => {
    const { dialog } = await gezeigt();

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

  /* The registrations list serves the pending ones alone: a link to a declined one opens a list it is not on, and the
     sentence that a registration ends with the ban is false of one its team declined already. */
  it("links no declined registration, names it declined, and says nothing of it ending", async () => {
    antwort = () =>
      Promise.resolve({
        ...NICHTS,
        registrierungen: [
          { registrierung_id: "6890a1b2c3d4e5f607250015", team_id: TEAM, saison_id: "2026", team_name: null, status: "abgelehnt", ...PERSON },
        ],
      });

    const { dialog } = await gezeigt();

    assert.deepEqual(verweiseIn(dialog), []);
    assert.ok(
      within(dialog).queryByText(/^Abgelehnte Registrierung für die Saison 2026: Zorbanax Quell$/) !== null,
      "the line hides its status",
    );
    assert.ok(within(dialog).queryByText(SPERRE_ANSICHT_COPY.lead) !== null, "a declined registration is said to end with the ban");
  });

  /* The memberships read lists a pupil holding no squad row, and the editor opens on them: their record is what stands. */
  it("links a pupil holding no squad row to their record", async () => {
    antwort = () => Promise.resolve({ ...NICHTS, spieler: [{ spieler_id: SPIELER, ...PERSON, kader: [] }] });

    const { dialog } = await gezeigt();

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

    const { dialog } = await gezeigt();

    // No fixtures link either: the referee holds no booking still to be played.
    assert.deepEqual(verweiseIn(dialog), [
      ["Eintrag ansehen", `/bereich/admin/spieler/${SPIELER}?saison_id=2024`],
      ["Kadereintrag austragen", `/bereich/admin/spieler/${SPIELER}?saison_id=2026`],
      ["Eintrag ansehen", `/bereich/admin/schiedsrichter/${SCHIEDSRICHTER}?saison_id=2025`],
    ]);
    // The season placed as every other line places it, the erasure's reveal of the same row included.
    assert.ok(
      within(dialog).queryByText(
        /^Spielerin oder Spieler: Zorbanax Quell, im Kader von Goethe-Gymnasium, Saison 2024, ausgetragen seit 01\.02\.2025$/,
      ) !== null,
      "the row taken out reads as one still in, or places its season otherwise",
    );
    assert.ok(within(dialog).queryByText(/Zorbanax Quell, stillgelegt seit 01\.03\.2025$/) !== null, "the retired referee reads as active");
  });

  /* The account and the log hold the address whatever the read found, so „nothing stored“ would be false. */
  it("says the address holds no record, and names its account and the log", async () => {
    antwort = () => Promise.resolve(NICHTS);

    const { dialog } = await gezeigt();

    for (const satz of [SPERRE_ANSICHT_COPY.leer, SPERRE_ANSICHT_COPY.konto, SPERRE_ANSICHT_COPY.protokoll]) {
      assert.ok(within(dialog).queryByText(satz) !== null, `an empty answer leaves out „${satz}“`);
    }
    assert.doesNotMatch(dialog.textContent, /nichts gespeichert/, "the empty answer says nothing is stored");
    assert.deepEqual(verweiseIn(dialog), []);
  });
});

describe("the order of the list and the ban (`docs/frontend/spec.md :: I724`)", () => {
  /* The list is worked through before the ban, so the press showing it writes nothing: a dialog closed over it bars
     nobody, and the second press alone bans, the address the list was read for. */
  it("reads the list on the first press, bans nobody until the armed press, and then bans that address", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const { dialog, user } = await gezeigt();

    assert.deepEqual(gesendet(ANSICHT_ENDPOINT), [{ email: BARRED }], "the list was read for another address, or not at all");
    assert.deepEqual(gesendet("/sperrliste"), [], "the press that shows the list wrote the ban");

    await sperren(dialog, user, t);

    assert.deepEqual(gesendet("/sperrliste"), [{ email: BARRED, grund: GRUND }]);
    assert.deepEqual(gesendet(ANSICHT_ENDPOINT), [{ email: BARRED }], "the ban read the list again");
  });

  /* The ban answers in a toast, as every create's dialog does, and closes it: the list was the step before the press.
     Opened again, the dialog is the next ban's form, a list left standing naming the last address's records. */
  it("closes on the ban with its title raised, and opens on the form again", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const { dialog, user } = await gezeigt();

    await sperren(dialog, user, t);

    await waitFor(() => assert.ok(screen.queryByRole("dialog") === null, "the ban left the dialog open"));
    assert.deepEqual(
      toasts.map(({ variant, title, description }) => [variant, title, description]),
      [["success", SPERRE_ERFOLG, undefined]],
    );
    await user.click(screen.getByRole("button", { name: "Adresse sperren" }));
    const reopened = await screen.findByRole("dialog");
    assert.equal((within(reopened).getByRole("textbox", { name: /E-Mail/ }) as HTMLInputElement).value, "", "the last ban's address stood");
    assert.ok(within(reopened).queryByText(SPERRE_ANSICHT_COPY.heading) === null, "the last ban's list stood over the form");
  });

  /* Once armed the press is no submit, so an Enter in a box, the reason being edited, reads nothing and bans nobody. */
  it("bans nobody on an Enter in either box once the list stands", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const { dialog, user } = await gezeigt();
    t.mock.timers.tick(DOUBLE_PRESS_MS);

    await user.type(within(dialog).getByRole("textbox", { name: /Grund/ }), " im Antrag{Enter}");
    await act(answered);

    assert.deepEqual(gesendet("/sperrliste"), [], "an Enter in the reason box banned the address");
    assert.ok(within(dialog).queryByRole("button", { name: SPERRE_PRESS.armed }) !== null, "the Enter disarmed the press");
  });

  /* A press over a box the ban would refuse reads nothing and arms nothing: the block every create form answers with. */
  it("reads no list over a box the ban would refuse, marking it", async () => {
    const { dialog, user } = await oeffnen();
    await user.clear(within(dialog).getByRole("textbox", { name: /Grund/ }));

    await zeigen(dialog, user);

    assert.deepEqual(gesendet(ANSICHT_ENDPOINT), [], "a refused draft was read for");
    assert.deepEqual(markiert(dialog), ["Grund"]);
    assert.deepEqual(
      toasts.map(({ title }) => title),
      [BLOCKED_SUBMIT_TITLE],
    );
    assert.ok(within(dialog).queryByRole("alert") === null, "a refused draft armed the press");
  });
});

describe("an address edited after its list was read (`docs/frontend/spec.md :: I724`)", () => {
  /* The list is the administrator's sight of the address: an edit of the box disarms the press over it, and the next
     press reads the list for the address the box holds then, the one the ban sends. */
  it("disarms on an edit of the address and bans only the address a fresh list was read for", async (t) => {
    t.mock.timers.enable({ apis: ["Date"] });
    const { dialog, user } = await gezeigt();
    const box = within(dialog).getByRole("textbox", { name: /E-Mail/ });

    await user.clear(box);
    await user.type(box, ANDERE);

    assert.ok(within(dialog).queryByRole("alert") === null, "the list read for the address before the edit stands");
    assert.ok(within(dialog).queryByRole("button", { name: SPERRE_PRESS.armed }) === null, "the press stayed armed over an edited address");
    await zeigen(dialog, user);
    await within(dialog).findByText(SPERRE_ANSICHT_COPY.heading);
    await sperren(dialog, user, t);
    assert.deepEqual(gesendet(ANSICHT_ENDPOINT), [{ email: BARRED }, { email: ANDERE }]);
    assert.deepEqual(gesendet("/sperrliste"), [{ email: ANDERE, grund: GRUND }]);
  });

  /* Next sends one client's actions one at a time, so a read made before an edit can answer after it: its list would
     arm a press for an address the box has stopped holding. */
  it("never lets a read made before an edit stand", async () => {
    let freigeben: (records: Record<string, unknown>) => void = () => undefined;
    antwort = () => new Promise((resolve) => (freigeben = resolve));
    const { dialog, user } = await oeffnen();
    await user.click(within(dialog).getByRole("button", { name: SPERRE_PRESS.resting }));
    await waitFor(() => assert.equal(gesendet(ANSICHT_ENDPOINT).length, 1, "the press read nothing"));

    await user.type(within(dialog).getByRole("textbox", { name: /E-Mail/ }), "x");
    freigeben(BESTAND);
    await act(answered);

    assert.ok(within(dialog).queryByText(SPERRE_ANSICHT_COPY.heading) === null, "the answer for the address before the edit was listed");
    assert.ok(within(dialog).queryByRole("button", { name: SPERRE_PRESS.armed }) === null, "the answer armed the press");
  });
});

describe("a list the read could not give (`docs/frontend/spec.md :: I724`)", () => {
  /* A read still running ends by itself: the press is held rather than closed, keeping the focus the arming left on it,
     and bans nothing until the list is on screen. */
  it("holds the press while the read runs, and bans once the list stands", async (t) => {
    let freigeben: (records: Record<string, unknown>) => void = () => undefined;
    antwort = () => new Promise((resolve) => (freigeben = resolve));
    t.mock.timers.enable({ apis: ["Date"] });
    const { dialog, user } = await oeffnen();
    await user.click(within(dialog).getByRole("button", { name: SPERRE_PRESS.resting }));
    await waitFor(() => assert.equal(gesendet(ANSICHT_ENDPOINT).length, 1, "the press read nothing"));

    t.mock.timers.tick(DOUBLE_PRESS_MS);
    const press = within(dialog).getByRole("button", { name: SPERRE_PRESS.armed });
    await user.click(press);

    assert.deepEqual(gesendet("/sperrliste"), [], "the press banned over the placeholder");
    assert.equal(press.getAttribute("data-pending"), "true", "a read still running left the press open rather than held");
    freigeben(BESTAND);
    await act(answered);
    await sperren(dialog, user, t);
    assert.deepEqual(gesendet("/sperrliste"), [{ email: BARRED, grund: GRUND }], "the press stayed held over the list");
  });

  /* The list is what the press is confirmed over, as the erasure's reveal is: unread, the press stays closed and says
     why on itself, and the next arming reads it again. */
  it("closes the press over a failed read, saying why, and bans nobody", async (t) => {
    antwort = () => Promise.reject(new Error("the backend answered nothing"));
    t.mock.timers.enable({ apis: ["Date"] });
    const { dialog, user } = await oeffnen();

    await zeigen(dialog, user);

    const grund = /^Die Übersicht, was unter der Adresse gespeichert ist, konnte nicht geladen werden, und ohne sie wird nicht gesperrt\./;
    assert.ok(within(within(dialog).getByRole("alert")).getByText(grund), "the reveal of a failed read says nothing of it");
    closedControl(SPERRE_PRESS.armed, grund);
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    for (const control of within(dialog).getAllByRole("button", { name: SPERRE_PRESS.armed })) await user.click(control);
    await act(answered);
    assert.deepEqual(gesendet("/sperrliste"), [], "a ban went out over a list nobody saw");
  });
});

describe("the ban's refusals, placed (`docs/frontend/spec.md :: I724`)", () => {
  /* The read refuses an administrator's address, the reader's own or an owner's, and lists a grant holder's: the ban
     would refuse each, so the box says so before anyone works through a list for nothing. */
  it("marks an administrator's address before the press, arming nothing", async () => {
    const answers: [string, () => Promise<Record<string, unknown>>][] = [
      ["a grant on the list", () => Promise.resolve({ ...NICHTS, verwaltung: "administration" })],
      ["the reader's own address", () => Promise.reject(refusedOn("POST /identitaet/erasure/ansicht", "REQ-PURGE-003"))],
      ["an owner's address", () => Promise.reject(refusedOn("POST /identitaet/erasure/ansicht", "REQ-PURGE-005"))],
    ];
    const verwaltung = mapSperreRefusal(refusedOn(CREATE_OPERATION, "REQ-SPERRLISTE-003"))?.fieldErrors?.email ?? "unworded";

    for (const [fall, gelesen] of answers) {
      antwort = gelesen;
      const { dialog, user } = await oeffnen();

      await zeigen(dialog, user);

      assert.deepEqual(markiert(dialog), ["E-Mail"], fall);
      assert.ok(within(dialog).queryByText(verwaltung) !== null, `${fall} reads otherwise than the ban's refusal`);
      assert.ok(within(dialog).queryByRole("alert") === null, `${fall} armed the press`);
      assert.deepEqual(gesendet("/sperrliste"), [], fall);
      cleanup();
    }
  });

  /* The read says whether a ban stands on the address (`docs/frontend/spec.md :: I730`): a second ban is refused, so
     the box says so in that refusal's words before anyone works through a list for nothing. */
  it("marks an address barred already before the press, arming nothing", async () => {
    antwort = () => Promise.resolve({ ...BESTAND, gesperrt: true });
    const schon = mapSperreRefusal(refusedOn(CREATE_OPERATION, "REQ-SPERRLISTE-001"))?.fieldErrors?.email ?? "unworded";
    const { dialog, user } = await oeffnen();

    await zeigen(dialog, user);

    assert.deepEqual(markiert(dialog), ["E-Mail"]);
    assert.ok(within(dialog).queryByText(schon) !== null, "the barred address reads otherwise than the ban's refusal");
    assert.ok(within(dialog).queryByRole("alert") === null, "the barred address armed the press");
    assert.ok(within(dialog).queryByText(SPERRE_ANSICHT_COPY.heading) === null, "the barred address's records were listed");
    assert.deepEqual(gesendet("/sperrliste"), []);
  });

  /* The read cannot tell a ban entered after it or a league with no season running: those land after the press, the
     address's on its box and the league's in the toast, the reveal closing over them. */
  it("lands a refusal the read cannot foresee where the ban's own answer puts it", async (t) => {
    const fehler = (code: string) => mapSperreRefusal(refusedOn(CREATE_OPERATION, code));
    t.mock.timers.enable({ apis: ["Date"] });

    sperre = () => Promise.reject(refusedOn(CREATE_OPERATION, "REQ-SPERRLISTE-001"));
    const schon = await gezeigt();
    await sperren(schon.dialog, schon.user, t);
    assert.deepEqual(markiert(schon.dialog), ["E-Mail"], "an address already barred was not marked");
    assert.ok(within(schon.dialog).queryByText(fehler("REQ-SPERRLISTE-001")?.fieldErrors?.email ?? "unworded") !== null);
    assert.deepEqual(toasts, [], "a refusal its box shows was raised as well");
    cleanup();

    sperre = () => Promise.reject(refusedOn(CREATE_OPERATION, "REQ-SPERRLISTE-002"));
    const keine = await gezeigt();
    await sperren(keine.dialog, keine.user, t);
    assert.deepEqual(markiert(keine.dialog), [], "the league's state marked a box");
    assert.deepEqual(
      toasts.map(({ variant, title, description }) => [variant, title, description]),
      [["danger", SPERRE_PRESS.nichtGesperrt, fehler("REQ-SPERRLISTE-002")?.error]],
    );
    assert.ok(within(keine.dialog).queryByRole("alert") === null, "the reveal stands over a refused ban");
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
