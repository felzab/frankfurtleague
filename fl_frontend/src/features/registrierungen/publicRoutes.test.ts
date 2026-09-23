import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, mock } from "node:test";

import { createElement as h } from "react";

import { parseDate } from "@internationalized/date";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest.ts";
import { getGermanTodayStr } from "@/shared/utils/date.ts";
import { ANTWORT_UNKLAR } from "@/shared/utils/publicSubmit.ts";

import { REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE } from "./constants.ts";
import { MAIL_ABGEWIESEN } from "./utils.ts";

import type { FLEinladungAnsichtResponse } from "./schemas.ts";
import type { SpielerBestaetigungGeoeffnet, SpielerFassung } from "./types.ts";

/** The write, answered by the case that sends one; unset, a request never returns. */
const fetchMock = mock.fn<() => Promise<Response>>(() => new Promise<never>(() => undefined));

// The browser's own `fetch` rather than the transport's module, so the panel's answer arrives through
// the one reader that decides which answers are this application's.
globalThis.fetch = (() => fetchMock()) as typeof fetch;

const { raised } = doubleToasts();

/*
 Every module below is reached AFTER both harnesses above have evaluated: the JSX compile step is
 registered, and the DOM installed, as each one does, and a static import resolves before either.
*/
const { RegistrierungView } = await import("./components/views/RegistrierungView.tsx");
const { RegistrierungFormPanel } = await import("./components/views/RegistrierungFormPanel.tsx");
const { SpielerBestaetigungView } = await import("./components/views/SpielerBestaetigungView.tsx");
const { STUFE_OPTIONS } = await import("@/features/spieler/constants.ts");

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");
const CONFIRM_PAGE = readFileSync(path.join(SRC_DIR, "app", "(public)", "bestaetigung", "spieler", "page.tsx"), "utf8");

/**
 * The team the invite opens, and a SECOND team of the same season that it does not.
 *
 * Two, because a one-team fixture satisfies „the page names no other club“ by having none to name.
 */
const TEAM = { name: "Lessing-Kolleg", full_name: "Lessing-Kolleg Oberstufengymnasium" };
const ANDERES_TEAM = { name: "Riedberg-Oberstufe", full_name: "Riedberg-Oberstufe Gesamtschule" };

/** The floor this fixture's READ answers. No constant mirrors it: every surface states what the link was minted under. */
const MIN_ALTER = 16;

/** The address a pupil types. It reaches no server render, and the case below is what keeps it out. */
const PUPIL_ADDRESS = "mira.kern@beispiel.test";

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
].map((eintrag) => ({ ...eintrag, html: renderMarkup(RegistrierungView, { start: eintrag.start }) }));

const seite = (stand: string): string => REGISTRIERUNG_STATES.find((eintrag) => eintrag.stand === stand)?.html ?? "";

const { SPIELER_EINWILLIGUNG } = await import("@/core/einwilligung.ts");

/**
 * The words the page stamps, read off the registry rather than retyped.
 *
 * A copy here compares the render with itself: the case stays green over a rewording, holding the
 * dead words it was written with.
 */
const ABSAETZE = SPIELER_EINWILLIGUNG.absaetzeNachSchluessel;

const FASSUNG: SpielerFassung = {
  textVersion: SPIELER_EINWILLIGUNG.textVersion,
  absaetze: ABSAETZE,
  schalter: SPIELER_EINWILLIGUNG.schalter,
  bedienelemente: SPIELER_EINWILLIGUNG.bedienelemente,
};

const GEOEFFNET: SpielerBestaetigungGeoeffnet = {
  acknowledged: 1,
  zustand: "gueltig",
  team: TEAM.name,
  schule: TEAM.full_name,
  saison_id: "2026",
  vorname: "Mira",
  text_version: FASSUNG.textVersion,
  mindestalter: MIN_ALTER,
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
  kontakt: "kontakt@frankfurtleague.de",
  loeschung: "Konto löschen",
  datenschutz: "Datenschutzerklärung",
};

const gefuellt = (text: string): string => text.replace(/\{(\w+)\}/g, (slot, name: string) => SLOTS[name] ?? slot);

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

  /* The panel's own comment says a dead link identifies nobody, and the banner above it named the
     team anyway: the state the WRITE found is what the header has to be derived from. */
  it("drops the team, the school and the season once the write finds the invite gone", async () => {
    const user = userEvent.setup();
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: false, zustand: "ungueltig" }), { status: 200 })),
    );

    const { container } = render(h(RegistrierungView, { start: { zustand: "gueltig", ansicht: ANSICHT, token: "kein-echtes-token" } }));

    await user.type(screen.getByRole("textbox", { name: /Vorname/ }), "Mira");
    await user.type(screen.getByRole("textbox", { name: /Nachname/ }), "Kern");
    await user.type(screen.getByRole("textbox", { name: /E-Mail/ }), PUPIL_ADDRESS);
    await user.click(screen.getByRole("button", { name: /Registrierung abschicken/ }));

    const html = await screen.findByText(/Frag in Deinem Team nach dem aktuellen Link/).then(() => container.innerHTML);

    assert.ok(!html.includes(TEAM.name), "the dead-link page still names the team");
    assert.ok(!html.includes(TEAM.full_name), "the dead-link page still names the school");
    assert.match(/<h1[^>]*>([^<]*)<\/h1>/.exec(html)?.[1] ?? "", /Link ung/, "the heading is not the dead link's");
  });

  it("says a pupil is nachnominiert only where the invite says the period has opened", () => {
    const laufend = renderMarkup(RegistrierungView, {
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
    const html = renderMarkup(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, onLinkTot: () => undefined });
    const alle = angeboteneStufen(html);
    // The blank and the „Keine Angabe“ sentinel are the control's own rows rather than a Stufe.
    const angeboten = alle.filter((key) => key !== "" && key !== "__none__");

    assert.ok(alle.length > angeboten.length, "the select renders no clearing row, so this filter is reading the wrong control");

    assert.ok(STUFE_OPTIONS.length > ANSICHT.erlaubte_stufen.length, "the season is as wide as the league, so this case compares nothing");
    assert.deepEqual(angeboten, [...ANSICHT.erlaubte_stufen], "the picker offers a Stufe the write path refuses, or drops one it takes");
  });
});

describe("what the registration's answer page tells a pupil who got no mail", () => {
  it("names the deadline off the mirrored constant and the way back from a typo", async () => {
    const user = userEvent.setup();
    fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })));

    render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, onLinkTot: () => undefined }));

    await user.type(screen.getByRole("textbox", { name: /Vorname/ }), "Mira");
    await user.type(screen.getByRole("textbox", { name: /Nachname/ }), "Kern");
    await user.type(screen.getByRole("textbox", { name: /E-Mail/ }), PUPIL_ADDRESS);
    await user.click(screen.getByRole("button", { name: /Registrierung abschicken/ }));

    const panel = await screen.findByRole("status");
    const worte = panel.textContent;

    assert.match(worte, new RegExp(String(REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE)), "the answer page states no deadline, or one of its own");
    assert.match(worte, /registriere Dich einfach noch einmal/, "the answer page offers no way back from a mistyped address");
    assert.equal(raised.length, 0, "a successful submission raised a failure toast");
  });

  /* The receipt above would otherwise tell a pupil whose address the provider rejected outright to
     wait for a message nobody sent, and the only thing they can repair is the address. */
  it("keeps the receipt away from a refused send, and puts the sentence on the address", async () => {
    const user = userEvent.setup();
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: false, fieldErrors: { email: MAIL_ABGEWIESEN } }), { status: 200 })),
    );

    render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, onLinkTot: () => undefined }));

    await user.type(screen.getByRole("textbox", { name: /Vorname/ }), "Mira");
    await user.type(screen.getByRole("textbox", { name: /Nachname/ }), "Kern");
    const adresse = screen.getByRole("textbox", { name: /E-Mail/ });
    await user.type(adresse, PUPIL_ADDRESS);
    await user.click(screen.getByRole("button", { name: /Registrierung abschicken/ }));

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

  const unklar = () =>
    raised.filter((toast) => toast.variant === "danger").map((toast) => [toast.title, toast.description] as [string, string | undefined]);

  it("titles a registration of unknown outcome as unclear, and names the second press as safe", async () => {
    raised.length = 0;
    const user = userEvent.setup();
    fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(UNKLAR, { status: 200 })));

    render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, onLinkTot: () => undefined }));

    await user.type(screen.getByRole("textbox", { name: /Vorname/ }), "Mira");
    await user.type(screen.getByRole("textbox", { name: /Nachname/ }), "Kern");
    await user.type(screen.getByRole("textbox", { name: /E-Mail/ }), PUPIL_ADDRESS);
    await user.click(screen.getByRole("button", { name: /Registrierung abschicken/ }));

    await screen.findByRole("button", { name: /Registrierung abschicken/ });
    assert.deepEqual(unklar(), [
      [
        "Unklar, ob es bei uns angekommen ist",
        "Schick die Registrierung noch einmal ab. Ist die erste doch angekommen, löscht sie sich ohne Bestätigung nach " +
          `${String(REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE)} Tagen von selbst.`,
      ],
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

    await screen.findByRole("button", { name: /Registrierung bestätigen/ });
    assert.deepEqual(unklar(), [["Unklar, ob es bei uns angekommen ist", ANTWORT_UNKLAR]]);
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
        if (absatz === gefuellt(text)) gezaehlt.set(schluessel, (gezaehlt.get(schluessel) ?? 0) + 1);
      }
    }

    assert.ok(gerendert.length > 0, "the page rendered nothing, so this case compares nothing");
    assert.deepEqual([...gezaehlt.keys()].sort(), Object.keys(ABSAETZE).sort(), "the page drops a stamped paragraph, or renders one twice");
    for (const [schluessel, wieOft] of gezaehlt) assert.equal(wieOft, 1, `${schluessel} stands on the page ${String(wieOft)} times`);
  });

  /* `fuelleFassung` leaves an unfilled slot standing, so a slot the page supplies no value for is
     spelled at a pupil in the middle of a consent sentence. */
  it("renders no slot as its own literal", () => {
    assert.doesNotMatch(textOf(STANDING, " "), /\{\w+\}/, "the consent text spells a placeholder at its reader");
  });

  it("takes the switch's label off that same version, and points the button at the stamped four", () => {
    const describedBy = [...STANDING.matchAll(/aria-describedby="([^"]*)"/g)].flatMap((hit) => (hit[1] ?? "").split(" "));

    assert.ok(textOf(STANDING).includes(FASSUNG.schalter), "the switch says something the stamped version does not hold");
    assert.ok(
      describedBy.some((id) => {
        const from = STANDING.indexOf(`id="${id}"`);

        return from !== -1 && textOf(STANDING.slice(from).split("</div>")[0] ?? "").includes(gefuellt(ABSAETZE.klickIdentitaet));
      }),
      "no described element holds the stamped points, so the button promises something written nowhere",
    );
  });

  /* A prop binding reaches no markup, so the page's own source is the only place the current label
     is tied to the words this view renders. */
  it("is handed the registry's current label by the page rather than reaching for one", () => {
    assert.match(
      CONFIRM_PAGE,
      /textVersion: SPIELER_EINWILLIGUNG\.textVersion/,
      "the page stamps a label other than the registry's current one",
    );
    // Every word off the CURRENT LABEL's entry: a page reaching past it renders whatever the keyed
    // object holds after the next rewording, under a label whose records cite the words before it.
    for (const member of ["absaetzeNachSchluessel", "schalter", "bedienelemente"]) {
      assert.match(CONFIRM_PAGE, new RegExp(`SPIELER_EINWILLIGUNG[.]${member}`), `the page reaches past the label for its ${member}`);
    }
    assert.doesNotMatch(CONFIRM_PAGE, /SPIELER_ABSAETZE/, "the page imports the copy object beside the label that freezes it");
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

  it("paints the media switch off for a pupil the league does not hold yet", () => {
    const schalter = /<input\b[^>]*name="medien"[^>]*>/.exec(bestaetigungSeite())?.[0] ?? "";

    assert.notEqual(schalter, "", "the media switch renders no control at all");
    assert.doesNotMatch(schalter, /\bchecked\b/, "the media consent is pre-selected, so nobody gave it");
  });

  /* A returning pupil confirms rather than re-enters: the date is shown as stored and both answers
     stand at what they were, or the page asks a question that was settled once. */
  it("shows a stored birthdate rather than asking again, and stands both answers at what they hold", () => {
    const html = bestaetigungSeite({ ...GEOEFFNET, geburtsdatum: "2008-09-01", umfang: "intern", medien: true });
    const schalter = /<input\b[^>]*name="medien"[^>]*>/.exec(html)?.[0] ?? "";

    assert.ok(!html.includes('name="geburtsdatum"'), "the page asks a returning pupil for a date it already holds");
    assert.ok(textOf(html).includes("01.09.2008"), "the stored date is not shown at all");
    assert.match(schalter, /\bchecked\b/, "a stored media consent opens as though it had never been given");

    const gewaehlt = scopeChips(html).filter((chip) => /aria-checked="true"/.test(chip.tag));
    assert.equal(gewaehlt.length, 1, "the page opens on no scope, or on both");
    assert.equal(gewaehlt[0]?.label, FASSUNG.bedienelemente.intern, "the page opens on a scope other than the stored one");
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

  it("lays the three controls out in the order the paragraphs read in", () => {
    const html = bestaetigungSeite();
    const stellen = REIHENFOLGE.map((name) => html.indexOf(`name="${name}"`));

    for (const [index, stelle] of stellen.entries()) assert.notEqual(stelle, -1, `${REIHENFOLGE[index] ?? ""} renders no control`);
    assert.deepEqual(
      [...stellen].sort((left, right) => left - right),
      stellen,
      "the controls stand in an order the copy does not read in",
    );
    // The paragraph belonging to each control stands above it, or a reader meets the answer before
    // the question.
    assert.ok(html.indexOf(gefuellt(ABSAETZE.geburtsdatum)) < stellen[0]!, "the birthdate paragraph stands below its control");
    assert.ok(html.indexOf(gefuellt(ABSAETZE.veroeffentlichung)) > stellen[0]!, "the publication paragraph stands above the date");
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
