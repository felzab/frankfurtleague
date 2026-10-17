import "@/shared/testing/dom.ts";

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { ADMIN_SIDEMENU_STRUCTURE } from "@/features/admin/constants.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { assertLeer } from "@/shared/testing/leerGrade.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answer, answerReadsWith, clearSteps, EMPTIEST_ANSWER, pageBody, readsOf, renderPage, steps } from "@/shared/testing/pageHarness.ts";

import type { ReactElement } from "react";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");
const ROUTE_DIR = path.join(SRC_DIR, "app", "bereich", "admin", "registrierungen");

describe("the route the sidemenu names", () => {
  const entries = ADMIN_SIDEMENU_STRUCTURE.flatMap((group) => group.sub_options);

  /* The id IS the route segment: the nav builds its href from it and the shell reads the page's one
     `<h1>` off the entry it matches. Renamed, both break and nothing else in the suite sees it. */
  it("names a segment that exists under /bereich/admin, with a loading state", () => {
    const entry = entries.find((option) => option.label === "Registrierungen");

    assert.ok(entry, "no sidemenu entry is labelled Registrierungen");
    assert.equal(entry.id, "registrierungen", "the entry's id moved off this slice's route segment");
    assert.ok(existsSync(path.join(SRC_DIR, "app", "bereich", "admin", entry.id, "page.tsx")), `/bereich/admin/${entry.id} has no page`);
    assert.ok(existsSync(path.join(ROUTE_DIR, "loading.tsx")), "the segment has no loading.tsx");
  });

  /* The team's own panel files its registrations under the in-tray, which this menu gives the
     applications an administrator decides: a glyph shared here would say this queue is worked down too. */
  it("draws a glyph no other entry draws", () => {
    const entry = entries.find((option) => option.id === "registrierungen");

    assert.ok(entry);
    assert.deepEqual(
      entries.filter((option) => option !== entry && option.iconName === entry.iconName).map((option) => option.id),
      [],
    );
  });
});

// An administrator's session: every admin-tier read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
doubleActionRequest();

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: AdminRegistrierungenPage } = await import("@/app/bereich/admin/registrierungen/page.tsx");
const { BESTAETIGT_MARKE, REGISTRIERUNGEN_CRUD_COPY } = await import("./constants.ts");

const TEAM_A = "6890a1b2c3d4e5f6071a0001";
const TEAM_B = "6890a1b2c3d4e5f6071a0002";
/** A team the club read does not know. */
const TEAM_FEHLT = "6890a1b2c3d4e5f6071a0009";

/** The season the address names, which no row below is in: a link carrying the header's season reads it. */
const ADRESS_SAISON = "2026";

/** What the read serves of a pupil and the page must never show nor hand its view: each string occurs nowhere else. */
const ADRESSE = "verborgen.adresse@registrierung.invalid";
const GEBURTSDATUM = "2007-11-23";
const GEBURTSTAG = "23.11.2007";

const club = (id: string, name: string) => ({
  id: id,
  name: name,
  shorthand: name.slice(0, 2).toUpperCase(),
  description: "",
  full_name: `${name} Frankfurt`,
  website_url: null,
  address: { strasse: "Hauptstraße", hausnummer: "1", plz: "60311", stadtteil: "", stadt: "Frankfurt am Main" },
  schulform: null,
  inactive_since: null,
  memberships: [],
});

/** One pending registration as the backend serves it to an administrator, address and birthdate included. */
const zeile = (id: string, team_id: string, saison_id: string, vorname: string, nachname: string, fields: Record<string, unknown> = {}) => ({
  id: id,
  saison_id: saison_id,
  team_id: team_id,
  einladung_id: "6890a1b2c3d4e5f6071c0001",
  eingereicht_am: "2026-09-20",
  status: "eingereicht",
  vorname: vorname,
  nachname: nachname,
  email: ADRESSE,
  position: "Tor",
  nummer: "7",
  stufe: "Q1",
  geburtsdatum: GEBURTSDATUM,
  einwilligung: null,
  bestaetigung: { verschickt_am: "2026-09-20", erinnert_am: null, frist: "2026-09-27", zustellung: null },
  entscheidung: null,
  bestaetigt: true,
  ...fields,
});

/** Lena confirmed for team A in a planned season; Mia has not answered for team B in a past one; Ole's team is gone. */
const LENA = zeile("6890a1b2c3d4e5f6071b0001", TEAM_A, "2027", "Lena", "Meier");
const MIA = zeile("6890a1b2c3d4e5f6071b0002", TEAM_B, "2025", "Mia", "Schmidt", {
  bestaetigt: false,
  geburtsdatum: null,
  eingereicht_am: "2026-09-18",
});
const OLE = zeile("6890a1b2c3d4e5f6071b0003", TEAM_FEHLT, "2027", "Ole", "Brandt", { stufe: null });

/** What the queue read answers in the running case. */
let queue: { registrierungen: unknown[]; vollstaendig: boolean } = { registrierungen: [LENA, MIA, OLE], vollstaendig: true };

answerReadsWith((endpoint, schema, params) => {
  if (endpoint === "/registrierungen") return answer(schema, endpoint, queue);
  if (endpoint === "/teams/memberships")
    return answer(schema, endpoint, { teams: [club(TEAM_A, "Goethe-Gymnasium"), club(TEAM_B, "Schiller-Schule")] });
  return EMPTIEST_ANSWER(endpoint, schema, params);
});

beforeEach(() => {
  queue = { registrierungen: [LENA, MIA, OLE], vollstaendig: true };
});

const pageProps = (search: Record<string, string>) => ({ params: Promise.resolve({}), searchParams: Promise.resolve(search) });

/** The page as a browser holds it at an address naming `search`, parsed. */
async function rendered(search: Record<string, string> = { saison_id: ADRESS_SAISON }): Promise<{ markup: string; page: Document }> {
  clearSteps();
  const markup = await renderPage(
    underNext(h(AdminRegistrierungenPage, pageProps(search)), {
      pathname: "/bereich/admin/registrierungen",
      search: new URLSearchParams(search),
    }),
  );

  return { markup, page: new DOMParser().parseFromString(markup, "text/html") };
}

/** The one card naming `name`, found by the pupil's name and never by its place in the list. */
function karte(page: Document, name: string): Element {
  const cards = [...page.querySelectorAll('ul[aria-label="Liste aller offenen Registrierungen"] > li')].filter((li) =>
    li.textContent.includes(name),
  );

  assert.equal(cards.length, 1, `${String(cards.length)} cards name ${name}`);
  return cards[0]!;
}

/** Every distinct link target on one card: the row's action draws twice, one per width. */
const hrefsOf = (card: Element): string[] => [...new Set([...card.querySelectorAll("a[href]")].map((link) => link.getAttribute("href")!))];

describe("the administrator's list of pending registrations", () => {
  /* An async default would hold the search bar behind the whole read. */
  it("returns its chrome synchronously", () => {
    const returned: unknown = (AdminRegistrierungenPage as (props: ReturnType<typeof pageProps>) => unknown)(pageProps({}));

    assert.equal(returned instanceof Promise, false, "the page awaits its data before the chrome renders");
  });

  /* A dropped `status` lists declined rows beside the pending ones, and every read below would still answer. */
  it("asks for the pending rows of every season, from the end the address names", async () => {
    const queueReads = () => readsOf(steps).filter(({ endpoint }) => endpoint === "/registrierungen");

    await rendered();
    assert.deepEqual(queueReads(), [{ endpoint: "/registrierungen", params: { status: "eingereicht", order: "desc" } }]);

    await rendered({ saison_id: ADRESS_SAISON, order: "asc" });
    assert.deepEqual(queueReads(), [{ endpoint: "/registrierungen", params: { status: "eingereicht", order: "asc" } }]);
  });

  /* Each card opens its OWN team's contacts in its OWN season, which no row shares with the address:
     a link carrying the header's season, or another row's team, opens seats the registration is not about. */
  it("links each card to its own team's contacts in its own season", async () => {
    const { page } = await rendered();

    assert.deepEqual(hrefsOf(karte(page, "Lena Meier")), [`/bereich/admin/kontakte/${TEAM_A}?saison_id=2027`]);
    assert.deepEqual(hrefsOf(karte(page, "Mia Schmidt")), [`/bereich/admin/kontakte/${TEAM_B}?saison_id=2025`]);
  });

  /* The day too, which the read orders by: a cut-short list's notice names an end, and the cards are
     what tell where it falls. */
  it("names each card's team, season and submission day", async () => {
    const { page } = await rendered();

    for (const [name, team, saison, tag] of [
      ["Lena Meier", "Goethe-Gymnasium", "2027", "Registriert am 20.09.2026"],
      ["Mia Schmidt", "Schiller-Schule", "2025", "Registriert am 18.09.2026"],
    ] as const) {
      const text = karte(page, name).textContent;
      assert.ok(text.includes(team), `${name}'s card does not name ${team}`);
      assert.ok(text.includes(saison), `${name}'s card does not name ${saison}`);
      assert.ok(text.includes(tag), `${name}'s card does not say „${tag}“`);
    }
  });

  /* Both states marked, per card: a page-wide count passes with the two marks swapped, and an unmarked
     state reads as the other wherever a mark failed to render. */
  it("marks each card confirmed or not, by its own pupil's answer", async () => {
    const { page } = await rendered();
    const marke = (name: string) => [...karte(page, name).querySelectorAll("span")].map((span) => span.textContent);

    assert.ok(marke("Lena Meier").includes(BESTAETIGT_MARKE.ja), "the confirmed card carries no confirmed mark");
    assert.ok(!marke("Lena Meier").includes(BESTAETIGT_MARKE.nein), "the confirmed card reads unconfirmed");
    assert.ok(marke("Mia Schmidt").includes(BESTAETIGT_MARKE.nein), "the unconfirmed card carries no unconfirmed mark");
    assert.ok(!marke("Mia Schmidt").includes(BESTAETIGT_MARKE.ja), "the unconfirmed card reads confirmed");
  });

  /* A team the club read does not know is said so in the empty-value grade, and the row's link names the
     pupil as well, so its control is told apart from every other row of that team. */
  it("says a team it cannot name is not recorded, and names the pupil on every row's link", async () => {
    const { page } = await rendered();
    const ole = karte(page, "Ole Brandt");
    // The innermost span holding the words, its slot's box around it holding the same text.
    const leer = [...ole.querySelectorAll("span")].filter((span) => span.children.length === 0 && span.textContent === "Nicht hinterlegt");

    assert.equal(leer.length, 2, "the missing team and the missing Stufe are not both in the empty-value grade");
    for (const span of leer) assertLeer(span, "Nicht hinterlegt");
    assert.deepEqual(
      [...new Set([...ole.querySelectorAll("a[href]")].map((link) => link.getAttribute("aria-label")))],
      ["Kontakte bearbeiten: Team nicht hinterlegt, Registrierung von Ole Brandt"],
    );
    assert.deepEqual(
      [...new Set([...karte(page, "Lena Meier").querySelectorAll("a[href]")].map((link) => link.getAttribute("aria-label")))],
      ["Kontakte bearbeiten: Goethe-Gymnasium, Registrierung von Lena Meier"],
    );
  });

  /* The read serves both; the page renders neither, and hands its client view neither, whose props are
     the payload a browser receives whether or not anything draws them. */
  it("neither shows nor hands its view the pupil's address or birthdate", async () => {
    const { markup } = await rendered();
    clearSteps();
    const view = (await pageBody(AdminRegistrierungenPage, pageProps({ saison_id: ADRESS_SAISON }))) as ReactElement<{
      registrierungen: { vorname: string }[];
    }>;
    const handed = JSON.stringify(view.props);

    // The controls: a markup or a payload holding no row at all would satisfy the absences below unread.
    assert.ok(markup.includes("Lena Meier"), "the page renders no row, so the absences below prove nothing");
    assert.deepEqual(
      view.props.registrierungen.map(({ vorname }) => vorname),
      ["Lena", "Mia", "Ole"],
      "the view is handed no row, so the absences below prove nothing",
    );
    for (const value of [ADRESSE, GEBURTSDATUM, GEBURTSTAG]) {
      assert.ok(!markup.includes(value), `the page renders ${value}`);
      assert.ok(!handed.includes(value), `the page hands its view ${value}`);
    }
  });

  /* Deciding stays with the team: the page offers the bar and the links out, and no write of any kind. */
  it("offers no form and no control but the search and the row links", async () => {
    const { page } = await rendered();
    const controls = [...page.querySelectorAll("a[href], button, input, select, textarea, [role=button], [role=switch]")];
    const searches = page.querySelectorAll('[data-slot="search-field"]');

    assert.equal(page.querySelectorAll("form").length, 0, "the page renders a form");
    assert.equal(searches.length, 1, "the page draws no search, or more than one");
    assert.ok(searches[0]!.querySelector('input[type="search"]'), "the search draws no search box");
    assert.equal(
      controls.filter((control) => control.matches('a[href^="/bereich/admin/kontakte/"]')).length,
      6,
      "each of the three cards draws its link once per width",
    );
    assert.deepEqual(
      controls
        .filter((control) => !control.matches('a[href^="/bereich/admin/kontakte/"]') && !searches[0]!.contains(control))
        .map((control) => control.outerHTML),
      [],
      "the page offers a control other than the search and the row links",
    );
  });
});

describe("the list's two ends and its empty state", () => {
  /* The harness's emptiest answer is `vollstaendig: false`, which would render the sentence beside the
     empty state: the empty queue here is a complete one. */
  it("says there is nothing pending, and nothing about a partial list, where the complete queue is empty", async () => {
    queue = { registrierungen: [], vollstaendig: true };
    const { markup } = await rendered();

    assert.ok(markup.includes(REGISTRIERUNGEN_CRUD_COPY.emptyOverall), "the empty queue renders no empty state");
    assert.ok(!markup.includes("Diese Liste ist unvollständig"), "a complete queue reads as partial");
  });

  /* Standing over the rows, and offering the other end of the queue under every other narrowing kept. */
  it("says a cut-short queue is partial, and offers its other end", async () => {
    queue = { registrierungen: [LENA], vollstaendig: false };
    const { markup, page } = await rendered({ saison_id: ADRESS_SAISON });

    assert.ok(markup.includes("Diese Liste ist unvollständig"), "a partial queue reads as complete");
    assert.ok(page.body.textContent.includes("Geladen sind die neuesten Registrierungen."), "the notice does not say which end is loaded");
    const umkehr = [...page.querySelectorAll("a[href]")].find((link) => link.textContent === "Lade die ältesten zuerst");
    assert.equal(umkehr?.getAttribute("href"), `?saison_id=${ADRESS_SAISON}&order=asc`);
  });

  /* The control for the case above: the sentence follows the answer, not the page. */
  it("says nothing of a partial list where the queue is complete", async () => {
    const { markup } = await rendered();

    assert.ok(markup.includes("Lena Meier"), "the page renders no row");
    assert.ok(!markup.includes("Diese Liste ist unvollständig"), "a complete queue reads as partial");
  });
});
