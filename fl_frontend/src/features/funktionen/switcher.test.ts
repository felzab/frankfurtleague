import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { person, sitz, SITZ } from "@/core/subjectFixtures.ts";
import { doubleActionRequest, doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answer, answerReadsWith, clearSteps, EMPTIEST_ANSWER, readsOf, renderPage, steps } from "@/shared/testing/pageHarness.ts";

import type { FLSubjektResponse } from "@/core/schemas.ts";
import type { ReactElement } from "react";

const { setSession, setSubject, subjectReads } = doubleActionRequest();
// The shells hand a sign-out action to the bar, whose real module reaches `next/server` past the harness.
doubleEveryAction();

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step and the doubles as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: TeamLayout } = await import("@/app/bereich/team/[team_id]/[saison_id]/layout.tsx");
const { default: PersoenlichLayout } = await import("@/app/bereich/(persoenlich)/layout.tsx");
const { default: AdminLayout } = await import("@/app/bereich/admin/layout.tsx");
const { default: PersoenlichStartPage } = await import("@/app/bereich/(persoenlich)/page.tsx");
const { funktionenOf } = await import("@/core/funktionen.ts");
const { funktionOrteOf } = await import("./utils.ts");

const TEAM_A = SITZ.team_id;

const SPIELER_ROW = { spieler_id: TEAM_A };
const SCHIEDSRICHTER_ROW = { schiedsrichter_id: TEAM_A };

/** The records the lookup answers the administrator's own address with, until a case names others. */
let adminRecords: Partial<FLSubjektResponse> = {};

answerReadsWith((endpoint, schema, params) =>
  endpoint === "/identitaet/subjekt" ? answer(schema, endpoint, adminRecords) : EMPTIEST_ANSWER(endpoint, schema, params),
);

/** The name the switcher's trigger carries in the markup, or `null` where the shell shows no switcher. */
const triggerIn = (markup: string): string | null => /aria-label="([^"]*: Funktion wechseln)"/.exec(markup)?.[1] ?? null;

/** What a render at `pathname` leaves, and every backend read it made on the way. */
async function renderedAt(tree: ReactElement, pathname: string): Promise<{ markup: string; reads: string[] }> {
  clearSteps();
  const markup = await renderPage(underNext(tree, { pathname }));

  return { markup: markup, reads: readsOf(steps).map(({ endpoint }) => endpoint) };
}

const teamAt = (pathname: string) =>
  renderedAt(h(TeamLayout, { params: Promise.resolve({ team_id: TEAM_A, saison_id: "2526" }), children: null }), pathname);

describe("the switcher each signed-in shell heads its sidemenu with", () => {
  it("names the team a seat holder stands in, where they hold another place", async () => {
    setSubject(person({ sitze: [sitz()], spieler: [SPIELER_ROW] }));
    const { markup, reads } = await teamAt(`/bereich/team/${TEAM_A}/2526`);

    assert.deepEqual(reads, [], "the team shell reads past the session its switcher is drawn from");
    assert.equal(triggerIn(markup), "Goethe-Gymnasium: Funktion wechseln");
  });

  /* One team in two seasons shares one title, so the trigger announces the season the address holds. */
  it("names the season too where the person holds the team in two seasons", async () => {
    setSubject(person({ sitze: [sitz(), sitz({ saison_id: "2627", saison_status: "future" })] }));
    const { markup, reads } = await teamAt(`/bereich/team/${TEAM_A}/2526`);

    assert.deepEqual(reads, [], "the team shell reads past the session its switcher is drawn from");
    assert.equal(triggerIn(markup), "Goethe-Gymnasium, Saison 2526: Funktion wechseln");
  });

  /* Two seats at one team and season are one place, which is no choice to offer. */
  it("shows none to a person whose seats all lead to the one team and season", async () => {
    setSubject(person({ sitze: [sitz({ rolle: "trainer" }), sitz()] }));
    const { markup, reads } = await teamAt(`/bereich/team/${TEAM_A}/2526`);

    assert.deepEqual(reads, [], "the team shell reads past the session its switcher is drawn from");
    assert.equal(triggerIn(markup), null);
  });

  it("names the person-lane page a person stands on", async () => {
    setSubject(person({ spieler: [SPIELER_ROW], schiedsrichter: [SCHIEDSRICHTER_ROW] }));
    const { markup, reads } = await renderedAt(h(PersoenlichLayout, { children: null }), "/bereich/spieler");

    assert.deepEqual(reads, [], "the person shell reads past the session its switcher is drawn from");
    assert.equal(triggerIn(markup), "Spieler: Funktion wechseln");
  });

  /* One page, one name: the rail's own entry and the bar call `/bereich` „Übersicht“, and so does the
     switcher standing there. */
  it("names the person's landing as the rail's entry for it does", async () => {
    setSubject(person({ spieler: [SPIELER_ROW], schiedsrichter: [SCHIEDSRICHTER_ROW] }));
    const { markup, reads } = await renderedAt(h(PersoenlichLayout, { children: null }), "/bereich");

    assert.deepEqual(reads, [], "the person shell reads past the session its switcher is drawn from");
    assert.equal(triggerIn(markup), "Übersicht: Funktion wechseln");
  });
});

describe("the places the switcher lists", () => {
  /* The switcher is the landing's list in a menu: what the landing's cards offer, in their order and under
     their words, is what a person reaching for the switcher expects. */
  it("are the landing's own cards, in their order and under their words", async () => {
    const subject = person({
      sitze: [sitz({ rolle: "trainer" }), sitz(), sitz({ team_id: "6890a1b2c3d4e5f607250012", team_name: "Lessing-Gymnasium" })],
      spieler: [SPIELER_ROW],
      schiedsrichter: [SCHIEDSRICHTER_ROW],
    });
    setSubject(subject);
    const { markup: landing, reads } = await renderedAt(h(PersoenlichStartPage), "/bereich");
    assert.deepEqual(reads, [], "the landing reads past the session its cards are drawn from");
    const cards = [
      ...landing.matchAll(/<a [^>]*href="([^"]*)"[^>]*>\s*<div[^>]*>\s*<span[^>]*>([^<]*)<\/span>\s*<span[^>]*>([^<]*)<\/span>/g),
    ].map(([, href, titel, detail]) => ({ href: href!, titel: titel!, detail: detail! }));

    assert.ok(cards.length >= 4, `the landing offers ${String(cards.length)} cards to compare against`);
    assert.deepEqual(
      funktionOrteOf(funktionenOf(subject).funktionen).map(({ href, titel, detail }) => ({ href, titel, detail })),
      cards,
    );
  });

  /* One team in two seasons is two places under one title: each is announced with its season, and a
     place whose title is its own is announced by the title alone. */
  it("names one team's two seasons apart, and every other place by its title", () => {
    const orte = funktionOrteOf(
      funktionenOf(person({ sitze: [sitz(), sitz({ saison_id: "2627", saison_status: "future" })], spieler: [SPIELER_ROW] })).funktionen,
    );

    assert.deepEqual(
      orte.map((ort) => ort.name),
      ["Goethe-Gymnasium, Saison 2526", "Goethe-Gymnasium, Saison 2627", "Spieler"],
    );
    assert.deepEqual(
      funktionOrteOf(funktionenOf(person({ sitze: [sitz()], spieler: [SPIELER_ROW] })).funktionen).map((ort) => ort.name),
      ["Goethe-Gymnasium", "Spieler"],
    );
  });
});

describe("the administrator's switcher", () => {
  const adminAt = async (records: Partial<FLSubjektResponse>) => {
    adminRecords = records;
    setSubject(null);
    clearSteps();
    const markup = await renderPage(underNext(h(AdminLayout, { children: null }), { pathname: "/bereich/admin/teams" }));

    return { markup: markup, reads: readsOf(steps).map(({ endpoint }) => endpoint) };
  };

  it("names the administration where the administrator also holds a seat", async () => {
    const { markup } = await adminAt({ sitze: [sitz()] });

    assert.equal(triggerIn(markup), "Verwaltung: Funktion wechseln");
  });

  it("shows none where the grant is all the administrator holds", async () => {
    const { markup } = await adminAt({});

    assert.equal(triggerIn(markup), null);
  });

  /* The records keyed on the admin session's own address, never through the person lane's guard, which
     sets a second actor. The lookup is the guard's own, memoised per render; beside it the season slot's list. */
  it("reads the records once through the lookup and never through the person guard", async () => {
    const { reads } = await adminAt({ sitze: [sitz()] });

    assert.deepEqual(
      reads,
      ["/identitaet/subjekt", "/saisons/list/admin"],
      "the administrator's render reads other than the lookup and the seasons",
    );
    assert.equal(subjectReads(), 0, "the administrator's render ran the person lane's guard");
  });

  /* One spelling per person: the session keeps the address as it was typed, and a lookup keyed on that
     spelling names a second mailbox to the join (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`). */
  it("asks about the admin session's own address, folded", async () => {
    // Two addresses, so a lookup keyed on any one fixed spelling answers one of them wrong.
    for (const [typed, folded] of [
      ["Vorstand@Example.org", "vorstand@example.org"],
      ["Kasse@Frankfurt-League.DE", "kasse@frankfurt-league.de"],
    ] as const) {
      setSession({ user: { email: typed } });
      await adminAt({ sitze: [sitz()] });

      assert.deepEqual(
        steps.flatMap((step) => (step.kind === "read" && step.endpoint === "/identitaet/subjekt" ? [step.body] : [])),
        [{ email: folded }],
        `the lookup for ${typed} asks about another address`,
      );
    }
  });
});
