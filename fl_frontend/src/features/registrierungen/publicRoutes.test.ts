import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createRef, createElement as h } from "react";

import { parseDate } from "@internationalized/date";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { KONTAKT_EMAIL } from "@/core/brand.ts";
import { einwilligungAnswer } from "@/core/einwilligungDocument.ts";
import { KONTO_HREF } from "@/core/kontoHref.ts";
import { TURNSTILE_HEADER } from "@/core/turnstileToken.ts";
import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { laufendeSpielerFassung, laufendeSpielerWiederkehrendFassung } from "@/shared/testing/einwilligungAnswers.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { answerReadsWith, EMPTIEST_ANSWER, pageBody } from "@/shared/testing/pageHarness.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest.ts";
import { assertOwnPanel, resultPanels } from "@/shared/testing/resultPanels.ts";
import { TEST_SITE_KEY } from "@/shared/testing/siteverifyDouble.ts";
import { filledSlots } from "@/shared/testing/stampedText.ts";
import { doubleTurnstile } from "@/shared/testing/turnstileDouble.ts";
import { FELD_ABGELEHNT } from "@/shared/utils/actionError.ts";
import { getGermanTodayStr } from "@/shared/utils/date.ts";
import { ANTWORT_UNKLAR } from "@/shared/utils/publicSubmit.ts";
import { LINK_ADRESSE_GESPERRT } from "@/shared/utils/reopenLink.ts";

import { REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE } from "./constants.ts";
import { MAIL_ABGEWIESEN } from "./utils.ts";

import type { ReactElement } from "react";
import type { FLEinladungAnsichtResponse } from "./schemas.ts";
import type { SpielerBestaetigungGeoeffnet, SpielerFassung, SpielerSeitenFassung, SpielerWiederkehrendFassung } from "./types.ts";

// The browser's own `fetch` rather than the transport's module, so the panel's answer arrives through
// the one reader that decides which answers are this application's.
const fetchMock = doubleFetch();
const turnstile = doubleTurnstile();

const { raised } = doubleToasts();

const failureToasts = () =>
  raised.filter((toast) => toast.variant === "danger").map((toast) => [toast.title, toast.description] as [string, string | undefined]);

/*
 Every module below is reached AFTER both harnesses above have evaluated: the JSX compile step is
 registered, and the DOM installed, as each one does, and a static import resolves before either.
*/
const { RegistrierungView } = await import("./components/views/RegistrierungView.tsx");
const { RegistrierungFormPanel } = await import("./components/views/RegistrierungFormPanel.tsx");
const { SpielerBestaetigungView } = await import("./components/views/SpielerBestaetigungView.tsx");
const { AdresseGesperrt, LinkUnlesbar } = await import("@/features/bewerbungen/components/views/BestaetigungPanels.tsx");
const { NUMMER_MAX_LENGTH, STUFE_OPTIONS } = await import("@/features/spieler/constants.ts");

const { default: SpielerBestaetigungPage } = await import("@/app/(public)/bestaetigung/spieler/page.tsx");

/**
 * The team the invite opens, and a SECOND team of the same season that it does not.
 *
 * Two, because a one-team fixture satisfies „the page names no other club“ by having none to name.
 */
const TEAM = { name: "Lessing-Kolleg", full_name: "Lessing-Kolleg Oberstufengymnasium" };
const ANDERES_TEAM = { name: "Riedberg-Oberstufe", full_name: "Riedberg-Oberstufe Gesamtschule" };

/** Typed rather than taken from `REGISTRIERUNG_MIN_ALTER`: the page judges by the floor the read serves, which is the one the link was minted under. */
const MIN_ALTER = 16;

/** The media age this fixture's read answers, for `MIN_ALTER`'s reason. */
const MEDIEN_ALTER = 18;

/** The address a pupil types. It reaches no server render, and the case below is what keeps it out. */
const PUPIL_ADDRESS = "mira.kern@beispiel.example";

const ANSICHT: FLEinladungAnsichtResponse = {
  acknowledged: 1,
  team: TEAM.name,
  schule: TEAM.full_name,
  saison_id: "2026",
  saison_status: "future",
  laeuft: true,
  // Narrowed to two of the league's six, so the case comparing the select against this set cannot
  // pass over a picker offering the whole ladder.
  erlaubte_stufen: ["Q1", "Q2"],
  kader_frei: true,
  team_eingetragen: true,
  nachnominierung: false,
};

const REGISTRIERUNG_STATES = [
  { stand: "gueltig", start: { zustand: "gueltig" as const, ansicht: ANSICHT, token: "kein-echtes-token" } },
  { stand: "kader-voll", start: { zustand: "gueltig" as const, ansicht: { ...ANSICHT, kader_frei: false }, token: "kein-echtes-token" } },
  { stand: "team-fehlt", start: { zustand: "gueltig" as const, ansicht: { ...ANSICHT, team_eingetragen: false }, token: "kein-echtes-token" } },
  { stand: "geschlossen", start: { zustand: "geschlossen" as const, ansicht: { ...ANSICHT, laeuft: false } } },
  { stand: "ungueltig", start: { zustand: "ungueltig" as const } },
  { stand: "unlesbar", start: { zustand: "unlesbar" as const } },
].map((eintrag) => ({ ...eintrag, html: renderMarkup(RegistrierungView, { siteKey: TEST_SITE_KEY, start: eintrag.start }) }));

const seite = (stand: string): string => REGISTRIERUNG_STATES.find((eintrag) => eintrag.stand === stand)?.html ?? "";

/** The thanks a confirmed registration's panel opens with. */
const ERFOLG = /Deine Registrierung für .+ ist bestätigt\./;

/**
 * The words the page stamps, read off the registry the backend generated rather than retyped.
 *
 * A copy here compares the render with itself: the case stays green over a rewording, holding the
 * dead words it was written with.
 */
const FASSUNG: SpielerFassung = laufendeSpielerFassung();

const ABSAETZE = FASSUNG.absaetze;

const GEOEFFNET: SpielerBestaetigungGeoeffnet = {
  acknowledged: 1,
  zustand: "gueltig",
  team: TEAM.name,
  schule: TEAM.full_name,
  saison_id: "2026",
  vorname: "Mira",
  seite: FASSUNG.seite,
  mindestalter: MIN_ALTER,
  medien_mindestalter: MEDIEN_ALTER,
  geburtsdatum: null,
  umfang: null,
  medien: null,
};

/** A birthdate this many whole years before the German day the page judges by, moved later by `tageSpaeter`. */
const geborenVor = (jahre: number, tageSpaeter = 0): string =>
  parseDate(getGermanTodayStr()).subtract({ years: jahre }).add({ days: tageSpaeter }).toString();

/** A stored date as the picker's segments take it typed: day, month, year. */
const getippt = (datum: string): string => {
  const [jahr, monat, tag] = datum.split("-");

  return `${tag ?? ""}${monat ?? ""}${jahr ?? ""}`;
};

const bestaetigungSeite = (ansicht: SpielerBestaetigungGeoeffnet = GEOEFFNET): string =>
  renderMarkup(SpielerBestaetigungView, {
    start: { zustand: "gueltig", ansicht: ansicht, token: "kein-echtes-token" },
    fassung: FASSUNG,
  });

/** The returning pupil's page's words, off the registry for `FASSUNG`'s reason. */
const WIEDERKEHREND: SpielerWiederkehrendFassung = laufendeSpielerWiederkehrendFassung();

/**
 * A link the backend resolved to a person it holds, confirmed, at this address and name: the stored
 * pair is media on, so a page reading it as a draft would send a grant.
 */
const WIEDERKEHREND_GEOEFFNET: SpielerBestaetigungGeoeffnet = {
  ...GEOEFFNET,
  seite: WIEDERKEHREND.seite,
  geburtsdatum: "2008-09-01",
  umfang: "intern",
  medien: true,
};

const wiederkehrendeSeite = (ansicht: SpielerBestaetigungGeoeffnet = WIEDERKEHREND_GEOEFFNET): string =>
  renderMarkup(SpielerBestaetigungView, {
    start: { zustand: "gueltig", ansicht: ansicht, token: "kein-echtes-token" },
    fassung: WIEDERKEHREND,
  });

/** Every paragraph and list item a render puts on the page, as a reader reads them. */
const paragraphsOf = (html: string): string[] =>
  [...html.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((hit) => textOf(hit[2] ?? "").trim());

/** The slots a record fills, as the page fills them, so a comparison reads what a reader read. */
const SLOTS: Readonly<Record<string, string>> = {
  vorname: GEOEFFNET.vorname,
  team: TEAM.name,
  schule: TEAM.full_name,
  saison: GEOEFFNET.saison_id,
  minAlter: String(MIN_ALTER),
  medienMinAlter: String(MEDIEN_ALTER),
  kontakt: "kontakt@frankfurtleague.de",
  loeschung: "Konto löschen",
  datenschutz: "Datenschutzerklärung",
};

describe("the state the registration page renders", () => {
  /* First: every case below reads these renders, and a fixture table that had collapsed onto one
     state would leave each of them asserting over the same page five times. */
  it("renders each of the six states the page has an answer for", () => {
    assert.deepEqual(
      REGISTRIERUNG_STATES.map((eintrag) => eintrag.stand).sort(),
      ["geschlossen", "gueltig", "kader-voll", "team-fehlt", "ungueltig", "unlesbar"],
      "the fixtures stopped putting the page into one state each",
    );
  });

  it("offers the form on the one state the write path accepts", () => {
    const mitFormular = REGISTRIERUNG_STATES.filter(({ html }) => html.includes('name="vorname"'));

    assert.deepEqual(
      mitFormular.map((eintrag) => eintrag.stand),
      ["gueltig"],
      "a state the write path refuses renders the form anyway",
    );
  });

  it("answers every closed state with a heading of its own", () => {
    const geschlossen = REGISTRIERUNG_STATES.filter(({ stand }) => stand !== "gueltig");
    const titel = geschlossen.map(({ html }) => /<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1] ?? "");

    for (const [index, wort] of titel.entries()) {
      assert.notEqual(wort, "", `${geschlossen[index]?.stand ?? ""} renders no answer at all`);
    }
    // Two states sharing a heading is the defect: a reader told the wrong one goes away for the
    // wrong reason, and „geschlossen“ against „ungültig“ is the pair that invites it.
    assert.equal(new Set(titel).size, titel.length, "two closed states give the reader the same answer");
  });

  /* „erneut“ is a retry's word: a link opened again is „noch einmal“, as every reopening sentence says it. */
  it("tells a pupil whose team's squad is full to open the link again once a place frees up", () => {
    assert.ok(
      textOf(seite("kader-voll")).includes("Wird im Kader wieder ein Platz frei, kannst Du den Link noch einmal öffnen."),
      "the full-squad page names no way back, or names it in a retry's words",
    );
  });

  it("names the team the invite opened and no other club of the season", () => {
    const html = seite("gueltig");

    assert.ok(html.includes(TEAM.name), "the page names the team the link belongs to nowhere");
    assert.ok(html.includes(TEAM.full_name), "the page names the school the link belongs to nowhere");
    for (const fremd of [ANDERES_TEAM.name, ANDERES_TEAM.full_name]) {
      assert.ok(!html.includes(fremd), `the page names another club of the season: ${fremd}`);
    }
  });

  it("puts no address on the page a stranger's link opens", () => {
    for (const { stand, html } of REGISTRIERUNG_STATES) {
      assert.ok(!html.includes(PUPIL_ADDRESS), `${stand} renders a registering person's address`);
    }
  });

  it("sends a team the season does not hold to the one place that can repair it", () => {
    const html = seite("team-fehlt");

    assert.ok(!html.includes('name="vorname"'), "the form is offered over a refusal the write always raises");
    assert.match(textOf(html, " "), /Frag in Deinem Team nach/, "the panel names nobody who could enter the team");
  });

  it("links the privacy notice on the state that collects anything", () => {
    assert.match(seite("gueltig"), /href="\/datenschutz"/, "the page collects personal data behind no notice at all");
  });

  /* A pupil's first contact is this form, so Art. 21(4) DSGVO asks the objection here, before
     anything is typed and apart from every other piece of information. */
  it("states the objection in a paragraph of its own before anything is typed", () => {
    assert.ok(
      paragraphsOf(seite("gueltig")).includes(
        "Der Verarbeitung Deiner Angaben für den Spielbetrieb kannst Du jederzeit aus Gründen widersprechen, die sich aus Deiner " +
          `besonderen Situation ergeben (Art. 21 DSGVO); eine formlose E-Mail an ${KONTAKT_EMAIL} genügt.`,
      ),
      "the registration form states no objection of its own",
    );
  });

  /* The panel's own comment says a dead link identifies nobody, and the banner above it named the
     team anyway: the state the WRITE found is what the header has to be derived from. */
  it("drops the team, the school and the season once the write finds the invite gone", async () => {
    const user = userEvent.setup();
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: false, zustand: "ungueltig" }), { status: 200 })),
    );

    const { container } = render(
      h(RegistrierungView, { siteKey: TEST_SITE_KEY, start: { zustand: "gueltig", ansicht: ANSICHT, token: "kein-echtes-token" } }),
    );

    await user.type(screen.getByRole("textbox", { name: /Vorname/ }), "Mira");
    await user.type(screen.getByRole("textbox", { name: /Nachname/ }), "Kern");
    await user.type(screen.getByRole("textbox", { name: /E-Mail/ }), PUPIL_ADDRESS);
    await user.click(screen.getByRole("button", { name: /Registrierung abschicken/ }));
    await act(fetchMock.answered);

    const satz = await screen.findByText(/Frag in Deinem Team nach dem aktuellen Link/);
    const html = container.innerHTML;

    assert.ok(!html.includes(TEAM.name), "the dead-link page still names the team");
    assert.ok(!html.includes(TEAM.full_name), "the dead-link page still names the school");
    assert.match(/<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1] ?? "", /Link ung/, "the heading is not the dead link's");
    // `ok` rather than `equal` on an element: a failure's report inspects both sides, and a jsdom node holds the whole window.
    assert.ok(
      document.activeElement === satz.closest('[role="status"]'),
      "the panel replaced the pressed button and the focus fell to the page",
    );
  });

  it("says a pupil is nachnominiert only where the invite says the period has opened", () => {
    const laufend = renderMarkup(RegistrierungView, {
      siteKey: TEST_SITE_KEY,
      start: { zustand: "gueltig", ansicht: { ...ANSICHT, nachnominierung: true }, token: "kein-echtes-token" },
    });

    assert.match(textOf(laufend, " "), /nachnominiert/, "a pupil joining a started season is not told what that makes them");
    // Matchday 1 decides the marker, never the season's status (`docs/glossary.md`, `ist_nachnominiert`).
    assert.match(
      textOf(laufend, " ").replace(/\s+/g, " "),
      // `textOf` sets its separator where the marked word's element closes.
      /Der erste Spieltag hat schon begonnen\. Du wirst deshalb nachnominiert ?\. Am Mitspielen ändert das nichts\./,
      "the banner gives the season's start as the reason, or drops what the marker leaves unchanged",
    );
    assert.doesNotMatch(textOf(seite("gueltig"), " "), /nachnominiert/, "an ordinary registration is called a Nachnominierung");
  });
});

describe("which Stufen the registration form offers", () => {
  /** The picker's options, read off the hidden native select the submitted value comes from. */
  function angeboteneStufen(html: string): string[] {
    const select = /<select[^>]*\bname="stufe"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";

    return [...select.matchAll(/<option value="([^"]*)"/g)].map((hit) => hit[1] ?? "");
  }

  /* The whole reason the read answers `erlaubte_stufen`: a select over the league's ladder hands a
     pupil a refusal at the press where the list could have refused it. */
  it("offers exactly the set the invite's own read answered", () => {
    const html = renderMarkup(RegistrierungFormPanel, {
      token: "kein-echtes-token",
      ansicht: ANSICHT,
      siteKey: TEST_SITE_KEY,
      onLinkTot: () => undefined,
    });
    const alle = angeboteneStufen(html);
    // The blank and the „Keine Angabe“ sentinel are the control's own rows rather than a Stufe.
    const angeboten = alle.filter((key) => key !== "" && key !== "__none__");

    assert.ok(alle.length > angeboten.length, "the select renders no clearing row, so this filter is reading the wrong control");

    assert.ok(STUFE_OPTIONS.length > ANSICHT.erlaubte_stufen.length, "the season is as wide as the league, so this case compares nothing");
    assert.deepEqual(angeboten, [...ANSICHT.erlaubte_stufen], "the picker offers a Stufe the write path refuses, or drops one it takes");
  });
});

describe("the Rückennummer box on the registration form", () => {
  it("stops taking digits at the cap the squad editor's box holds", async () => {
    const user = userEvent.setup();
    render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, siteKey: TEST_SITE_KEY, onLinkTot: () => undefined }));
    const box = screen.getByRole("textbox", { name: "Rückennummer" });

    await user.type(box, "1".repeat(NUMMER_MAX_LENGTH + 1));

    assert.equal((box as HTMLInputElement).value, "1".repeat(NUMMER_MAX_LENGTH), "the pupil types a number the schema then refuses");
  });
});

describe("what the registration's answer page tells a pupil who got no mail", () => {
  it("names the deadline off the mirrored constant and the way back from a typo", async () => {
    const user = userEvent.setup();
    fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })));

    render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, siteKey: TEST_SITE_KEY, onLinkTot: () => undefined }));

    await user.type(screen.getByRole("textbox", { name: /Vorname/ }), "Mira");
    await user.type(screen.getByRole("textbox", { name: /Nachname/ }), "Kern");
    await user.type(screen.getByRole("textbox", { name: /E-Mail/ }), PUPIL_ADDRESS);
    await user.click(screen.getByRole("button", { name: /Registrierung abschicken/ }));
    await act(fetchMock.answered);

    const panel = await screen.findByRole("status");
    const worte = panel.textContent;
    assertOwnPanel(document.body.innerHTML, /registriere Dich einfach erneut/, "eingegangen");

    assert.match(worte, new RegExp(String(REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE)), "the answer page states no deadline, or one of its own");
    assert.match(worte, /registriere Dich einfach erneut/, "the answer page offers no way back from a mistyped address");
    assert.equal(raised.length, 0, "a successful submission raised a failure toast");
  });

  it("carries the token its bot check minted for the press", async () => {
    const user = userEvent.setup();
    fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })));
    render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, siteKey: TEST_SITE_KEY, onLinkTot: () => undefined }));
    await user.type(screen.getByRole("textbox", { name: /Vorname/ }), "Mira");
    await user.type(screen.getByRole("textbox", { name: /Nachname/ }), "Kern");
    await user.type(screen.getByRole("textbox", { name: /E-Mail/ }), PUPIL_ADDRESS);
    const minted = turnstile.lastMinted();

    await user.click(screen.getByRole("button", { name: /Registrierung abschicken/ }));
    await act(fetchMock.answered);

    assert.ok(minted !== undefined, "the form's widget minted nothing");
    assert.deepEqual(
      fetchMock.mock.calls.map(({ arguments: [, init] }) => (init?.headers as Record<string, string>)[TURNSTILE_HEADER]),
      [minted],
    );
  });

  /* The receipt above would otherwise tell a pupil whose address the provider rejected outright to
     wait for a message nobody sent, and the only thing they can repair is the address. */
  it("keeps the receipt away from a refused send, and puts the sentence on the address", async () => {
    const user = userEvent.setup();
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: false, fieldErrors: { email: MAIL_ABGEWIESEN } }), { status: 200 })),
    );

    render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, siteKey: TEST_SITE_KEY, onLinkTot: () => undefined }));

    await user.type(screen.getByRole("textbox", { name: /Vorname/ }), "Mira");
    await user.type(screen.getByRole("textbox", { name: /Nachname/ }), "Kern");
    const adresse = screen.getByRole("textbox", { name: /E-Mail/ });
    await user.type(adresse, PUPIL_ADDRESS);
    await user.click(screen.getByRole("button", { name: /Registrierung abschicken/ }));
    await act(fetchMock.answered);

    await screen.findByText(MAIL_ABGEWIESEN);

    assert.ok(screen.queryByRole("status") === null, "a send nobody accepted answered with the receipt");
    // Announced by the move rather than by a toast, which is how every other server refusal this
    // form marks reaches a reader who cannot see the mark.
    assert.ok(document.activeElement === adresse, "the refusal marks the address and leaves the caret where the press left it");
  });
});

/* A commit whose answer was lost: the route's sentence is an administrator's reload-and-check, and
   neither page can follow it, the invite's and the confirmation's token being gone from the address. */
describe("what the two public pages tell a pupil whose write may have landed", () => {
  const UNKLAR = JSON.stringify({ success: false, error: "Ob die Änderung gespeichert wurde, ist unklar.", outcome: "unknown" });

  it("titles a registration of unknown outcome as unclear, and names the second press as safe", async () => {
    raised.length = 0;
    const user = userEvent.setup();
    fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(UNKLAR, { status: 200 })));

    render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, siteKey: TEST_SITE_KEY, onLinkTot: () => undefined }));

    await user.type(screen.getByRole("textbox", { name: /Vorname/ }), "Mira");
    await user.type(screen.getByRole("textbox", { name: /Nachname/ }), "Kern");
    await user.type(screen.getByRole("textbox", { name: /E-Mail/ }), PUPIL_ADDRESS);
    await user.click(screen.getByRole("button", { name: /Registrierung abschicken/ }));
    await act(fetchMock.answered);

    await screen.findByRole("button", { name: /Registrierung abschicken/ });
    assert.deepEqual(failureToasts(), [
      ["Unklar, ob es bei uns angekommen ist", "Schick die Registrierung hier unverändert erneut ab: Doppelt ankommen kann sie so nicht."],
    ]);
  });

  it("titles a confirmation of unknown outcome as unclear, and tells the pupil to reopen the link", async () => {
    raised.length = 0;
    const user = userEvent.setup();
    fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(UNKLAR, { status: 200 })));

    render(h(SpielerBestaetigungView, { start: { zustand: "gueltig", ansicht: GEOEFFNET, token: "kein-echtes-token" }, fassung: FASSUNG }));

    await user.click(screen.getByRole("radio", { name: FASSUNG.bedienelemente.intern }));
    const [tag] = screen.getAllByRole("spinbutton");
    await user.click(tag!);
    await user.keyboard(getippt(geborenVor(MIN_ALTER + 1)));
    await user.click(screen.getByRole("button", { name: /Registrierung bestätigen/ }));
    await act(fetchMock.answered);

    await screen.findByRole("button", { name: /Registrierung bestätigen/ });
    assert.deepEqual(failureToasts(), [["Unklar, ob es bei uns angekommen ist", ANTWORT_UNKLAR]]);
  });
});

/* Each page is handed the answer the route sends for a `REQ-VAL-001` naming only a path none of its
   controls renders, and has to announce the sentence the answer brings rather than the generic one. */
describe("what the two public pages say about a refusal no box of theirs can take", () => {
  const EIGENER_SATZ = "Der Satz, den die Antwort für diesen Fall mitbringt.";

  const answeredWith = (path: string) =>
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ success: false, fieldErrors: { [path]: FELD_ABGELEHNT }, unplacedError: EIGENER_SATZ }), {
          status: 200,
        }),
      ),
    );

  it("puts the registration's own sentence under the registration's title", async () => {
    raised.length = 0;
    const user = userEvent.setup();
    answeredWith("token");

    const { container } = render(
      h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, siteKey: TEST_SITE_KEY, onLinkTot: () => undefined }),
    );
    assert.ok(container.querySelector('[name="token"]') === null, "the case's path is one a control renders");

    await user.type(screen.getByRole("textbox", { name: /Vorname/ }), "Mira");
    await user.type(screen.getByRole("textbox", { name: /Nachname/ }), "Kern");
    await user.type(screen.getByRole("textbox", { name: /E-Mail/ }), PUPIL_ADDRESS);
    await user.click(screen.getByRole("button", { name: /Registrierung abschicken/ }));
    await act(fetchMock.answered);

    await waitFor(() => assert.deepEqual(failureToasts(), [["Registrierung nicht abgeschickt", EIGENER_SATZ]]));
  });

  /* A repeated press whose details changed is refused, yet the first registration stands: titled
     „nicht abgeschickt“, the toast would send the pupil to register a second time. */
  it("titles the refusal of a repeated press as arrived, over the answer's own sentence", async () => {
    raised.length = 0;
    const user = userEvent.setup();
    const SCHON_DA = "Deine Registrierung ist schon angekommen.";
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: false, error: SCHON_DA, schonAngekommen: true }), { status: 200 })),
    );

    render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, siteKey: TEST_SITE_KEY, onLinkTot: () => undefined }));

    await user.type(screen.getByRole("textbox", { name: /Vorname/ }), "Mira");
    await user.type(screen.getByRole("textbox", { name: /Nachname/ }), "Kern");
    await user.type(screen.getByRole("textbox", { name: /E-Mail/ }), PUPIL_ADDRESS);
    await user.click(screen.getByRole("button", { name: /Registrierung abschicken/ }));
    await act(fetchMock.answered);

    await waitFor(() => assert.deepEqual(failureToasts(), [["Registrierung schon angekommen", SCHON_DA]]));
  });

  it("puts the confirmation's own sentence under the confirmation's title", async () => {
    raised.length = 0;
    const user = userEvent.setup();
    answeredWith("text_version");

    const { container } = render(
      h(SpielerBestaetigungView, { start: { zustand: "gueltig", ansicht: GEOEFFNET, token: "kein-echtes-token" }, fassung: FASSUNG }),
    );
    assert.ok(container.querySelector('[name="text_version"]') === null, "the case's path is one a control renders");

    await user.click(screen.getByRole("radio", { name: FASSUNG.bedienelemente.intern }));
    const [tag] = screen.getAllByRole("spinbutton");
    await user.click(tag!);
    await user.keyboard(getippt(geborenVor(MIN_ALTER + 1)));
    await user.click(screen.getByRole("button", { name: /Registrierung bestätigen/ }));
    await act(fetchMock.answered);

    await waitFor(() => assert.deepEqual(failureToasts(), [["Antwort nicht gespeichert", EIGENER_SATZ]]));
  });
});

describe("which of the confirmation page's words its stamped version covers", () => {
  const STANDING = bestaetigungSeite();

  /* A record cites its label alone, so a paragraph the page spells for itself leaves that record
     claiming words its reader was never shown. */
  it("renders every paragraph the version holds, exactly once", () => {
    const gezaehlt = new Map<string, number>();
    const gerendert = paragraphsOf(STANDING);

    for (const absatz of gerendert) {
      for (const [schluessel, text] of Object.entries(ABSAETZE)) {
        if (absatz === filledSlots(text, SLOTS)) gezaehlt.set(schluessel, (gezaehlt.get(schluessel) ?? 0) + 1);
      }
    }

    assert.ok(gerendert.length > 0, "the page rendered nothing, so this case compares nothing");
    assert.deepEqual([...gezaehlt.keys()].sort(), Object.keys(ABSAETZE).sort(), "the page drops a stamped paragraph, or renders one twice");
    for (const [schluessel, wieOft] of gezaehlt) assert.equal(wieOft, 1, `${schluessel} stands on the page ${String(wieOft)} times`);
  });

  /* `Gefuellt` leaves an unfilled slot standing, so a slot the page supplies no value for is
     spelled at a pupil in the middle of a consent sentence. */
  it("renders no slot as its own literal", () => {
    assert.doesNotMatch(textOf(STANDING, " "), /\{\w+\}/, "the consent text spells a placeholder at its reader");
  });

  it("takes the switch's label off that same version, and points the button at the stamped four", () => {
    const describedBy = [...STANDING.matchAll(/aria-describedby="([^"]*)"/g)].flatMap((hit) => (hit[1] ?? "").split(" "));
    // The switch stands only for a pupil of the media age, so its words are read on that page.
    const volljaehrig = bestaetigungSeite({ ...GEOEFFNET, geburtsdatum: geborenVor(MEDIEN_ALTER), umfang: "intern", medien: false });

    assert.ok(textOf(volljaehrig).includes(FASSUNG.schalter), "the switch says something the stamped version does not hold");
    assert.ok(
      describedBy.some((id) => {
        const from = STANDING.indexOf(`id="${id}"`);

        return from !== -1 && textOf(STANDING.slice(from).split("</div>")[0] ?? "").includes(filledSlots(ABSAETZE.klickIdentitaet, SLOTS));
      }),
      "no described element holds the stamped points, so the button promises something written nowhere",
    );
  });

  /**
   * The page's body for an open link the backend resolved to `seite`, `laufend` being what it runs on
   * that page, `seiten` the registry's whole answer and `scheitert` failing the words read.
   */
  async function handedFassung({
    seite = FASSUNG.seite,
    laufend,
    seiten,
    scheitert = false,
  }: {
    seite?: SpielerSeitenFassung["seite"];
    laufend?: string;
    seiten?: unknown;
    scheitert?: boolean;
  } = {}): Promise<SpielerSeitenFassung | null> {
    answerReadsWith((endpoint, schema, params) => {
      if (scheitert && endpoint.startsWith("/einwilligung/fassungen/")) throw new Error(`the backend failed ${endpoint}`);
      if (endpoint === "/registrierungen/bestaetigung/ansicht") return { ...GEOEFFNET, seite: seite };
      if (endpoint === "/einwilligung/seiten" && seiten !== undefined) return seiten;
      // Over the registry's other labels: the page reads both pupil pages' words, whichever the link names.
      if (endpoint === "/einwilligung/seiten" && laufend !== undefined) {
        const registry = einwilligungAnswer(endpoint) as { laufende_fassungen: Record<string, string> };

        return { acknowledged: 1, laufende_fassungen: { ...registry.laufende_fassungen, [seite]: laufend } };
      }
      return einwilligungAnswer(endpoint) ?? EMPTIEST_ANSWER(endpoint, schema, params);
    });
    const body = (await pageBody(SpielerBestaetigungPage, {
      params: Promise.resolve({}),
      searchParams: Promise.resolve({ token: "kein-echtes-token" }),
    })) as ReactElement<{ fassung: SpielerSeitenFassung | null }>;

    return body.props.fassung;
  }

  /* The words are the backend's, read per request for the label it runs: a page holding its own copy
     renders a wording the backend may have moved past, under a label it does not stamp. */
  it("is handed the words the backend serves for the label it runs on the page the link opens", async () => {
    assert.deepEqual(await handedFassung(), FASSUNG, "the page renders words other than the ones the backend serves");
    assert.deepEqual(
      await handedFassung({ seite: WIEDERKEHREND.seite }),
      WIEDERKEHREND,
      "a returning pupil's link is handed words other than its own page's",
    );
  });

  /* A label whose sections were never kept by key is a broken contract rather than a failed read: it
     reaches the error boundary, which logs it, never the panel asking for a reload. */
  it("lets a running label the page cannot place reach the error boundary", async () => {
    await assert.rejects(
      handedFassung({ laufend: "2026-09-spielerseite-2" }),
      { name: "ZodError" },
      "the page absorbed words it holds no keys for",
    );
    // The new pupil's words where the returning pupil's page runs: they ask choices that page has no place for.
    await assert.rejects(
      handedFassung({ seite: WIEDERKEHREND.seite, laufend: FASSUNG.textVersion }),
      { name: "ZodError" },
      "the returning page absorbed words asking choices it does not ask",
    );
  });

  /* A registry answering against what this page was built for is no failed read: only a deploy repairs
     it, so it reaches the error boundary, which logs it, never the panel asking for a reload. */
  it("lets a registry breaking its contract reach the error boundary", async () => {
    const registry = einwilligungAnswer("/einwilligung/seiten") as { laufende_fassungen: Record<string, string> };
    const ohneWiederkehrend = Object.fromEntries(
      Object.entries(registry.laufende_fassungen).filter(([seite]) => seite !== WIEDERKEHREND.seite),
    );

    // The returning pupil's page missing fails a new pupil's link too: one registry serves both pages.
    await assert.rejects(handedFassung({ seiten: { acknowledged: 1, laufende_fassungen: ohneWiederkehrend } }), { name: "ContractBreakError" });
    await assert.rejects(handedFassung({ laufend: "2026-01-nirgends" }), { name: "ContractBreakError" }, "a label serving no words");
    await assert.rejects(handedFassung({ seiten: { acknowledged: 1 } }), { name: "APIMalformedDataError" }, "an answer off its schema");
  });

  /* The read failing is a state of its own, which a reload may clear. */
  it("hands the view no words where the words read fails", async () => {
    assert.equal(await handedFassung({ scheitert: true }), null, "a failed words read reached the view as words");
    assert.equal(
      textOf(
        renderMarkup(SpielerBestaetigungView, { start: { zustand: "gueltig", ansicht: GEOEFFNET, token: "kein-echtes-token" }, fassung: null }),
      ),
      textOf(renderMarkup(SpielerBestaetigungView, { start: { zustand: "unlesbar" }, fassung: null })),
      "an open link whose words could not be read renders something other than the failed read's panel",
    );
  });
});

describe("the three answers the confirmation page collects", () => {
  /** Every scope the choice offers, as its own control reports itself: the tag, and whether it is picked. */
  function scopeChips(html: string): { tag: string; label: string }[] {
    const gruppe = /<div\b[^>]*role="radiogroup"[^>]*>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";

    return [...gruppe.matchAll(/<button\b([^>]*role="radio"[^>]*)>([\s\S]*?)<\/button>/g)].map((hit) => ({
      tag: hit[1] ?? "",
      label: textOf(hit[2] ?? "").trim(),
    }));
  }

  it("offers both publication scopes and pre-selects neither", () => {
    const chips = scopeChips(bestaetigungSeite());

    assert.equal(chips.length, 2, "the page offers a number of scopes other than both");
    assert.notEqual(chips[0]?.label, chips[1]?.label, "the two scopes read alike, so a reader cannot tell them apart");
    // The stamped paragraph tells the reader to choose „intern“, so a chip that never says the
    // word leaves them looking for a control the text named and the page did not.
    assert.ok(
      chips.some((chip) => /intern/i.test(chip.label)),
      `no chip carries the word the consent text tells a reader to choose: ${chips.map((chip) => chip.label).join(" | ")}`,
    );
    // And the words are the label's, so a record reproduces the question beside the answer.
    assert.deepEqual([...chips].map((chip) => chip.label).sort(), Object.values(FASSUNG.bedienelemente).sort());
    for (const chip of chips) assert.match(chip.tag, /aria-checked="false"/, `„${chip.label}“ is chosen before the reader chose`);
  });

  it("paints the media switch off for a pupil the league does not hold yet, once their date offers it", async () => {
    const user = userEvent.setup();
    render(h(SpielerBestaetigungView, { start: { zustand: "gueltig", ansicht: GEOEFFNET, token: "kein-echtes-token" }, fassung: FASSUNG }));

    const [tag] = screen.getAllByRole("spinbutton");
    await user.click(tag!);
    await user.keyboard(getippt(geborenVor(MEDIEN_ALTER + 2)));

    const schalter = screen.getByRole("switch", { name: new RegExp(FASSUNG.schalter.slice(0, 20)) }) as HTMLInputElement;

    assert.equal(schalter.checked, false, "the media consent is pre-selected, so nobody gave it");
  });

  /* A stored pair is the returning page's to show, never this page's to start from: a chip or a switch
     opening on it is a consent nobody gave here, and a press would stamp it as given today. */
  it("starts from nothing on the new pupil's page, whatever pair the read served", () => {
    const html = bestaetigungSeite({ ...GEOEFFNET, geburtsdatum: geborenVor(MEDIEN_ALTER + 2), umfang: "intern", medien: true });
    const schalter = /<input\b[^>]*name="medien"[^>]*>/.exec(html)?.[0] ?? "";

    assert.notEqual(schalter, "", "the date offers the switch, so this case compares nothing without it");
    assert.doesNotMatch(schalter, /\bchecked\b/, "the media switch opens on the served answer");
    assert.deepEqual(
      scopeChips(html).filter((chip) => /aria-checked="true"/.test(chip.tag)),
      [],
      "the page opens on the served scope",
    );
  });

  /* One mailbox behind two pupils: the read narrows by the folded name as well as the address, so it
     answers nothing stored for a person of another name. */

  /* This page must then ASK, never show the sibling's date back as though it were this reader's. */
  it("asks for everything again where the read answered no stored answers", () => {
    const html = bestaetigungSeite({ ...GEOEFFNET, geburtsdatum: null, umfang: null, medien: null });
    const schalter = /<input\b[^>]*name="medien"[^>]*>/.exec(html)?.[0] ?? "";

    assert.ok(html.includes('name="geburtsdatum"'), "the page shows a date back instead of asking for one");
    assert.doesNotMatch(schalter, /\bchecked\b/, "the media switch opens as though a consent had been given");
    assert.deepEqual(
      scopeChips(html).filter((chip) => /aria-checked="true"/.test(chip.tag)),
      [],
      "the page opens on a scope nobody at this address chose",
    );
  });

  it("bounds the date control by the floor the link answered rather than a constant of its own", () => {
    const streng = bestaetigungSeite({ ...GEOEFFNET, mindestalter: 18 });

    assert.match(textOf(bestaetigungSeite(), " "), new RegExp(`mindestens ${String(MIN_ALTER)} Jahre`), "the page states no floor");
    assert.match(textOf(streng, " "), /mindestens 18 Jahre/, "the page states a floor of its own rather than the read's");
  });
});

describe("how a pupil operates the confirmation page without a pointer", () => {
  /** The three controls, in the order the copy reads them in. */
  const REIHENFOLGE = ["geburtsdatum", "umfang", "medien"] as const;

  it("lays the three controls out in the order the paragraphs read in", async () => {
    const user = userEvent.setup();
    const { container } = render(
      h(SpielerBestaetigungView, { start: { zustand: "gueltig", ansicht: GEOEFFNET, token: "kein-echtes-token" }, fassung: FASSUNG }),
    );

    // A date of the media age first, which is what puts the third control on the page at all.
    const [tag] = screen.getAllByRole("spinbutton");
    await user.click(tag!);
    await user.keyboard(getippt(geborenVor(MEDIEN_ALTER + 2)));

    const html = container.innerHTML;
    const stellen = REIHENFOLGE.map((name) => html.indexOf(`name="${name}"`));

    for (const [index, stelle] of stellen.entries()) assert.notEqual(stelle, -1, `${REIHENFOLGE[index] ?? ""} renders no control`);
    assert.deepEqual(
      [...stellen].sort((left, right) => left - right),
      stellen,
      "the controls stand in an order the copy does not read in",
    );
    // The paragraph belonging to each control stands above it, or a reader meets the answer before
    // the question.
    assert.ok(html.indexOf(filledSlots(ABSAETZE.geburtsdatum, SLOTS)) < stellen[0]!, "the birthdate paragraph stands below its control");
    assert.ok(html.indexOf(filledSlots(ABSAETZE.veroeffentlichung, SLOTS)) > stellen[0]!, "the publication paragraph stands above the date");
  });

  it("gives each of the three an accessible name and a tab stop", async () => {
    const user = userEvent.setup();
    render(
      h(SpielerBestaetigungView, {
        start: { zustand: "gueltig", ansicht: GEOEFFNET, token: "kein-echtes-token" },
        fassung: FASSUNG,
      }),
    );

    // Resolved by ROLE and NAME, which is how a reader who cannot see finds them: a control named by
    // its position alone is reachable by a pointer and by nothing else.
    const datum = screen.getByRole("group", { name: /Geburtsdatum/ });
    const wahl = screen.getByRole("radiogroup", { name: /Was darf von Deinem Namen/ });

    // A date of the media age first, then the ring walked again from the top of the page.
    const [tag] = screen.getAllByRole("spinbutton");
    await user.click(tag!);
    await user.keyboard(getippt(geborenVor(MEDIEN_ALTER + 2)));
    (document.activeElement as HTMLElement | null)?.blur();

    const medien = screen.getByRole("switch", { name: new RegExp(FASSUNG.schalter.slice(0, 20)) });

    for (const control of [datum, wahl, medien]) assert.ok(control, "a control resolves by no accessible name");

    // Every stop the keyboard reaches, in order, so a control the tab ring skips is caught rather
    // than merely rendered.
    const erreicht: string[] = [];
    for (let step = 0; step < 24; step++) {
      await user.tab();
      const active = document.activeElement;
      if (active !== null && (datum.contains(active) || wahl.contains(active) || medien === active || medien.contains(active))) {
        erreicht.push(datum.contains(active) ? "geburtsdatum" : wahl.contains(active) ? "umfang" : "medien");
      }
    }

    assert.deepEqual([...new Set(erreicht)], ["geburtsdatum", "umfang", "medien"], "the keyboard does not reach all three in the copy's order");
  });

  it("announces the age refusal rather than only rendering it", async () => {
    const user = userEvent.setup();
    render(
      h(SpielerBestaetigungView, {
        start: { zustand: "gueltig", ansicht: GEOEFFNET, token: "kein-echtes-token" },
        fassung: FASSUNG,
      }),
    );

    // The scope first: a payload short of it fails the object parse, and the date's own refusal is
    // then never reached — which is the shape that would leave this case asserting nothing.
    await user.click(screen.getByRole("radio", { name: FASSUNG.bedienelemente.intern }));

    const [tag] = screen.getAllByRole("spinbutton");
    await user.click(tag!);
    await user.keyboard("01012020");

    await user.click(screen.getByRole("button", { name: /Registrierung bestätigen/ }));

    // A `FieldError` is a plain span in no live region, so a refusal reaching a screen reader as a
    // button that did nothing is the failure this case refuses to allow.
    const angesagt = [...document.querySelectorAll('[role="alert"],[aria-live]')].map((node) => node.textContent ?? "");

    assert.ok(
      angesagt.some((worte) => worte.includes("Geburtsdatum")),
      `nothing announces the refused date: ${angesagt.join(" || ")}`,
    );
    assert.ok(
      raised.some((toast) => toast.variant === "danger"),
      "the blocked press raises nothing a reader who cannot see the mark would hear",
    );
  });
});

describe("the media switch, offered from the media age alone", () => {
  const schalterIn = (html: string): string => /<input\b[^>]*name="medien"[^>]*>/.exec(html)?.[0] ?? "";

  /** Every body a press sends, the route's answer being a stored `false` whatever arrives. */
  async function gesendetBeiDruck(
    ansicht: SpielerBestaetigungGeoeffnet,
    vorDemDruck?: (user: ReturnType<typeof userEvent.setup>) => Promise<void>,
  ) {
    const antwort = {
      success: true,
      ergebnis: "bestaetigt",
      geburtsdatum: ansicht.geburtsdatum ?? "2000-01-01",
      umfang: "intern",
      medien: false,
    };
    fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(antwort), { status: 200 })));
    const bisher = fetchMock.mock.callCount();

    const user = userEvent.setup();
    render(h(SpielerBestaetigungView, { start: { zustand: "gueltig", ansicht: ansicht, token: "kein-echtes-token" }, fassung: FASSUNG }));
    await vorDemDruck?.(user);
    await user.click(screen.getByRole("button", { name: /Registrierung bestätigen/ }));
    await act(fetchMock.answered);
    await screen.findByRole("heading", { name: "Registrierung bestätigt" });
    assertOwnPanel(document.body.innerHTML, ERFOLG, "erfolg");

    return fetchMock.mock.calls.slice(bisher).map((call) => {
      const body = call.arguments[1]?.body;

      return JSON.parse(typeof body === "string" ? body : "null") as unknown;
    });
  }

  it("offers no switch while no birthdate says how old the pupil is", () => {
    assert.equal(schalterIn(bestaetigungSeite()), "", "a pupil of unknown age is offered a consent the write refuses below the media age");
  });

  it("offers no switch to a pupil whose read date is a day short of the media age", () => {
    const html = bestaetigungSeite({ ...GEOEFFNET, geburtsdatum: geborenVor(MEDIEN_ALTER, 1) });

    assert.equal(schalterIn(html), "", "a pupil under the media age is offered the media switch");
  });

  it("offers the switch to a pupil whose read date is the media age to the day", () => {
    const html = bestaetigungSeite({ ...GEOEFFNET, geburtsdatum: geborenVor(MEDIEN_ALTER) });

    assert.notEqual(schalterIn(html), "", "a pupil of the media age is refused the switch the ruling offers them");
  });

  it("withdraws the switch and its yes when the typed date moves below the media age", async () => {
    const gesendet = await gesendetBeiDruck({ ...GEOEFFNET, geburtsdatum: null }, async (user) => {
      await user.click(screen.getByRole("radio", { name: FASSUNG.bedienelemente.intern }));
      const [tag] = screen.getAllByRole("spinbutton");
      await user.click(tag!);
      await user.keyboard(getippt(geborenVor(MEDIEN_ALTER + 2)));
      await user.click(screen.getByRole("switch", { name: new RegExp(FASSUNG.schalter.slice(0, 20)) }));

      await user.click(tag!);
      await user.keyboard(getippt(geborenVor(MEDIEN_ALTER - 1)));
      // A boolean rather than the node: a failing `assert.equal` inspects its operand without a depth
      // bound, and a DOM node's graph exhausts the machine's memory before the message is built.
      assert.ok(screen.queryByRole("switch") === null, "the switch stands for a date under the media age");
    });

    assert.equal(
      (gesendet[0] as { medien?: unknown } | undefined)?.medien,
      false,
      "the yes given at the older date was sent for the younger one",
    );
  });
});

describe("the returning pupil's confirmation page", () => {
  const STANDING = wiederkehrendeSeite();

  /** The body the press sends, and the panel it lands on, the route answering as it does for this page. */
  async function gedrueckt(ansicht: SpielerBestaetigungGeoeffnet = WIEDERKEHREND_GEOEFFNET) {
    const antwort = { success: true, ergebnis: "bestaetigt", geburtsdatum: ansicht.geburtsdatum ?? "2008-09-01", umfang: null, medien: null };
    fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(antwort), { status: 200 })));
    const bisher = fetchMock.mock.callCount();

    const user = userEvent.setup();
    const { unmount } = render(
      h(SpielerBestaetigungView, { start: { zustand: "gueltig", ansicht: ansicht, token: "kein-echtes-token" }, fassung: WIEDERKEHREND }),
    );
    await user.click(screen.getByRole("button", { name: /Registrierung bestätigen/ }));
    await act(fetchMock.answered);
    await screen.findByRole("heading", { name: "Registrierung bestätigt" });
    assertOwnPanel(document.body.innerHTML, ERFOLG, "erfolg");
    const panel = textOf(document.querySelector('section[role="status"]')?.innerHTML ?? "", " ");
    unmount();

    const gesendet = fetchMock.mock.calls.slice(bisher).map((call) => {
      const body = call.arguments[1]?.body;

      return JSON.parse(typeof body === "string" ? body : "null") as Record<string, unknown>;
    });

    return { gesendet, panel };
  }

  /* The choices stand on the person's own record, so a control for either here would take an answer
     the page then stamps as given today over whatever the person moved since. */
  it("asks no choice, and shows the stored pair read-only beside the way to the account page", () => {
    const text = textOf(STANDING, " ");

    assert.ok(!STANDING.includes('role="radiogroup"'), "the returning page offers the publication scopes");
    assert.ok(!STANDING.includes('name="umfang"') && !STANDING.includes('name="medien"'), "the returning page renders a choice's control");
    assert.ok(text.includes(WIEDERKEHREND.bedienelemente.intern), "the stored scope is not shown in its label's words");
    assert.match(text, /Fotos, Videos und Interviews\s*erlaubt/, "the stored media answer is not shown");
    assert.ok(STANDING.includes(`href="${KONTO_HREF}"`), "the page names no way to the account page, where the choices are changed");
  });

  it("shows a stored birthdate rather than asking again, and asks one where none is stored", () => {
    assert.ok(!STANDING.includes('name="geburtsdatum"'), "the page asks for a date the league already holds");
    assert.ok(textOf(STANDING).includes("01.09.2008"), "the stored date is not shown at all");
    assert.ok(
      wiederkehrendeSeite({ ...WIEDERKEHREND_GEOEFFNET, geburtsdatum: null }).includes('name="geburtsdatum"'),
      "no date is asked where none is stored",
    );
  });

  /* A record cites its label alone, as on the new pupil's page. */
  it("renders every paragraph its version holds, exactly once, and no slot as its own literal", () => {
    const gezaehlt = new Map<string, number>();

    for (const absatz of paragraphsOf(STANDING)) {
      for (const [schluessel, text] of Object.entries(WIEDERKEHREND.absaetze)) {
        if (absatz === filledSlots(text, SLOTS)) gezaehlt.set(schluessel, (gezaehlt.get(schluessel) ?? 0) + 1);
      }
    }

    assert.deepEqual([...gezaehlt.keys()].sort(), Object.keys(WIEDERKEHREND.absaetze).sort(), "the page drops a stamped paragraph");
    for (const [schluessel, wieOft] of gezaehlt) assert.equal(wieOft, 1, `${schluessel} stands on the page ${String(wieOft)} times`);
    assert.doesNotMatch(textOf(STANDING, " "), /\{\w+\}/, "the text spells a placeholder at its reader");
  });

  /* The stale re-grant this page exists to end: a press carrying the pair the page opened on stamps it
     later than a withdrawal made meanwhile on the account page, and the admission carries it. */
  it("sends neither choice, under its own page's label", async () => {
    const { gesendet } = await gedrueckt();

    assert.equal(gesendet.length, 1, "the press sent nothing, so this case compares nothing");
    assert.deepEqual([gesendet[0]?.["umfang"], gesendet[0]?.["medien"]], [null, null], "the press sent a choice the page did not ask");
    assert.equal(gesendet[0]?.["text_version"], WIEDERKEHREND.textVersion, "the press names a label other than its page's");
  });

  /* The answer carries no choice, the page having sent none, so the panel states the pair that stands. */
  it("states the stored pair in the answer panel", async () => {
    const { panel } = await gedrueckt();

    assert.ok(panel.includes(WIEDERKEHREND.bedienelemente.intern), "the answer panel drops the standing scope");
    assert.match(panel, /Fotos, Videos und Interviews\s*erlaubt/, "the answer panel drops the standing media answer");
  });
});

describe("what a link to a barred address opens on", () => {
  it("is the shared barred page and nothing beside it", () => {
    assert.equal(
      renderMarkup(SpielerBestaetigungView, { start: { zustand: "gesperrt" }, fassung: FASSUNG }),
      renderMarkup(AdresseGesperrt, { panelRef: createRef<HTMLElement>() }),
      "the page draws its own barred page, or something beside the shared one",
    );
  });

  /* A ban entered while the form stood open: the refused press swaps the form for the same page
     rather than raising the sentence as a toast over the form. */
  it("swaps an open form for that page when the press is refused on the ban", async () => {
    raised.length = 0;
    fetchMock.mock.mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ success: false, zustand: "gesperrt" }))));
    const user = userEvent.setup();
    const { unmount } = render(
      h(SpielerBestaetigungView, { start: { zustand: "gueltig", ansicht: GEOEFFNET, token: "kein-echtes-token" }, fassung: FASSUNG }),
    );

    await user.click(screen.getByRole("radio", { name: FASSUNG.bedienelemente.intern }));
    const [tag] = screen.getAllByRole("spinbutton");
    await user.click(tag!);
    await user.keyboard(getippt(geborenVor(MIN_ALTER + 1)));
    await user.click(screen.getByRole("button", { name: /Registrierung bestätigen/ }));
    await act(fetchMock.answered);

    const shown = await screen.findByText(LINK_ADRESSE_GESPERRT);
    const buttons = screen.queryAllByRole("button").length;
    const toasts = raised.length;
    unmount();

    assert.ok(shown, "the page kept the form the press cannot use again");
    assert.equal(buttons, 0, "a press stands beside the barred sentence");
    assert.equal(toasts, 0, "the ban was raised as a toast over the form");
  });
});

/* Each state answers with one panel: a second beside it tells the pupil two outcomes, and a link the
   backend could not check may still be live, so its panel says only that it does not know. */
describe("the result panel each state of the two pupil pages shows", () => {
  const [unlesbar = ""] = resultPanels(renderMarkup(LinkUnlesbar, {}));

  it("shows the registration page's own panel for each state and no other", () => {
    assert.match(unlesbar, /gerade nicht prüfen/, "the shared panel no longer says the link went unchecked");
    const eigenes: Record<string, string | null> = {
      gueltig: null,
      "kader-voll": "Der Kader dieses Teams ist für diese Saison voll",
      "team-fehlt": "Dieses Team spielt in dieser Saison nicht mit",
      geschlossen: "Für diese Saison ist die Registrierung geschlossen.",
      ungueltig: "Dieser Link gilt nicht mehr.",
      unlesbar: unlesbar,
    };

    for (const { stand, html } of REGISTRIERUNG_STATES) {
      assert.ok(Object.hasOwn(eigenes, stand), `no panel named for ${stand}`);
      assertOwnPanel(html, eigenes[stand] ?? null, stand);
    }
  });

  it("shows the confirmation page's own panel for each state the link opens on and no other", () => {
    const dead = "Dieser Link ist ungültig oder abgelaufen";
    for (const [start, eigenes] of [
      [{ zustand: "gueltig", ansicht: GEOEFFNET, token: "kein-echtes-token" }, null],
      [{ zustand: "bestaetigt" }, "Diese Registrierung ist schon bestätigt."],
      [{ zustand: "abgelaufen" }, dead],
      [{ zustand: "ungueltig" }, dead],
      [{ zustand: "gesperrt" }, LINK_ADRESSE_GESPERRT],
      [{ zustand: "unlesbar" }, unlesbar],
    ] as const) {
      assertOwnPanel(renderMarkup(SpielerBestaetigungView, { start, fassung: FASSUNG }), eigenes, start.zustand);
    }
  });
});

describe("the address a link page opened under", () => {
  /** Where the page stands once it has opened at `url`. */
  function adresseNach(url: string, seite: ReactElement): string {
    window.history.replaceState(null, "", url);
    const { unmount } = render(seite);
    const adresse = `${window.location.pathname}${window.location.search}`;
    unmount();

    return adresse;
  }

  it("loses the invite's token on the registration page", () => {
    const adresse = adresseNach(
      "/registrierung?token=kein-echtes-token",
      h(RegistrierungView, { siteKey: TEST_SITE_KEY, start: { zustand: "ungueltig" } }),
    );

    assert.equal(adresse, "/registrierung", "the page leaves its token in the address bar");
  });

  it("loses the link's token on the pupil's confirmation page", () => {
    const adresse = adresseNach(
      "/bestaetigung/spieler?token=kein-echtes-token",
      h(SpielerBestaetigungView, { start: { zustand: "bestaetigt" }, fassung: FASSUNG }),
    );

    assert.equal(adresse, "/bestaetigung/spieler", "the page leaves its token in the address bar");
  });

  it("keeps the invite's token on the registration page where the invite could not be read", () => {
    const adresse = adresseNach(
      "/registrierung?token=kein-echtes-token",
      h(RegistrierungView, { siteKey: TEST_SITE_KEY, start: { zustand: "unlesbar" } }),
    );

    assert.equal(adresse, "/registrierung?token=kein-echtes-token", "the page stripped the token a reload needs");
  });

  it("keeps the link's token on the pupil's confirmation page where the link could not be read", () => {
    const adresse = adresseNach(
      "/bestaetigung/spieler?token=kein-echtes-token",
      h(SpielerBestaetigungView, { start: { zustand: "unlesbar" }, fassung: FASSUNG }),
    );

    assert.equal(adresse, "/bestaetigung/spieler?token=kein-echtes-token", "the page stripped the token a reload needs");
  });
});
