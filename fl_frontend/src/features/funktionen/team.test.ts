import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { doubleActionRequest, doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { callPage, redirectTarget, renderPage } from "@/shared/testing/pageHarness.ts";
import { textOf } from "@/shared/testing/renderTest.ts";

import type { FLSubjektSitz } from "@/core/schemas.ts";
import type { SubjectSession } from "@/core/subject.ts";

const { setSubject } = doubleActionRequest();
// The shell hands a sign-out action to the bar, whose real module reaches `next/server` past the harness.
doubleEveryAction();

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step and the doubles as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: TeamLayout } = await import("@/app/bereich/team/[team_id]/[saison_id]/layout.tsx");
const { default: TeamStartPage } = await import("@/app/bereich/team/[team_id]/[saison_id]/page.tsx");

const TEAM_A = "6890a1b2c3d4e5f607250011";
const TEAM_B = "6890a1b2c3d4e5f607250012";

const sitz = (fields: Partial<FLSubjektSitz> = {}): FLSubjektSitz => ({
  saison_id: "2526",
  team_id: TEAM_A,
  rolle: "ansprechperson",
  team_name: "Goethe-Gymnasium",
  saison_status: "active",
  ...fields,
});

/** A person holding what `records` names and nothing else. */
const person = (records: Partial<SubjectSession["subjekt"]> = {}): SubjectSession => ({
  email: "pia@example.org",
  admin: false,
  subjekt: { sitze: [], spieler: [], schiedsrichter: [], unbestaetigt: false, ...records },
});

/** The landing as the team area mounts it at one address: under its layout, whose guard runs first. */
const landingAt = (teamId: string, saisonId: string) => {
  const params = Promise.resolve({ team_id: teamId, saison_id: saisonId });

  return () => h(TeamLayout, { params: params, children: h(TeamStartPage, { params: params, searchParams: Promise.resolve({}) }) });
};

/** What a browser holds once the landing's stream at that address has run. */
async function rendered(teamId: string, saisonId: string): Promise<{ markup: string; text: string }> {
  const markup = await renderPage(underNext(h(landingAt(teamId, saisonId)), { pathname: `/bereich/team/${teamId}/${saisonId}` }));

  return { markup: markup, text: textOf(markup, " ").replace(/\s+/g, " ") };
}

/** The page's one heading, which the shell's top bar carries. */
const heading = (markup: string): string => textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup)?.[1] ?? "", " ").trim();

/** Every link the markup offers, as its href and its visible text. */
const linksIn = (markup: string): { href: string; text: string }[] =>
  [...markup.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, inner]) => ({
    href: href!,
    text: textOf(inner!, " ").replace(/\s+/g, " ").trim(),
  }));

const FORBIDDEN_BADGE = "Tribüne";

describe("the guard over a team's area", () => {
  /* Driven through the layout, so the case fails wherever the redirect goes missing. */
  it("sends a request with no person's session to sign in", async () => {
    setSubject(null);
    const { thrown } = await callPage(landingAt(TEAM_A, "2526"), { params: Promise.resolve({}), searchParams: Promise.resolve({}) });

    assert.deepEqual(
      thrown.flatMap((error) => redirectTarget(error) ?? []),
      ["/signin"],
    );
  });
});

describe("what a seat holder meets at their team's address", () => {
  /* The shell is the person's own navigation, and the landing names what they are there: the team as
     it played that season, and every role they hold on it, each in its long form. */
  it("renders the landing inside the team shell, naming the team and the person's roles", async () => {
    setSubject(person({ sitze: [sitz({ rolle: "trainer" }), sitz({ rolle: "ansprechperson" })] }));
    const { markup, text } = await rendered(TEAM_A, "2526");

    assert.ok(markup.includes("data-app-shell"), "the landing renders outside the team shell");
    assert.equal(heading(markup), "Übersicht");
    assert.match(markup, /<h2[^>]*>Goethe-Gymnasium<\/h2>/, "the landing's heading does not name the team");
    assert.ok(text.includes("Du bist hier als Ansprechperson und Trainerin oder Trainer eingetragen."), text);
    assert.ok(!markup.includes(FORBIDDEN_BADGE), "a seat holder is shown the forbidden panel");
  });

  /* The season is the address's own segment, so the chip names it and no link repeats it as a query. */
  it("names the address's season in the shell and carries it on no link as a query", async () => {
    setSubject(person({ sitze: [sitz()] }));
    const { markup, text } = await rendered(TEAM_A, "2526");

    assert.ok(text.includes("Saison 2526"), "the shell names no season");
    assert.deepEqual(
      linksIn(markup).filter((link) => link.href.includes("?")),
      [],
      "these links carry a query the team area never reads",
    );
    assert.ok(
      linksIn(markup).some((link) => link.href === `/bereich/team/${TEAM_A}/2526` && link.text === "Übersicht"),
      "the shell lists no landing entry at the address itself",
    );
  });
});

describe("what a person meets at an address they hold no seat on", () => {
  /* Inside the shell, so the person meets their own navigation, and naming nothing of the address: no
     entry, no season, no role, nothing about who holds a seat there or whether the team exists. */
  it("renders the forbidden panel inside the shell for another team, linking to the team the person holds", async () => {
    setSubject(person({ sitze: [sitz()] }));
    // A season the person holds nothing in either, so a mention of it can only be the address's.
    const { markup, text } = await rendered(TEAM_B, "2627");

    assert.ok(markup.includes("data-app-shell"), "the forbidden panel renders outside the team shell");
    assert.ok(markup.includes(FORBIDDEN_BADGE), "the forbidden panel is not what renders");
    assert.ok(text.includes("Hier bist Du nicht eingetragen."), text);
    assert.ok(!text.includes("Du bist hier als"), "the landing renders behind the forbidden panel");
    assert.ok(!markup.includes(TEAM_B), "the answer names the address's team");
    assert.ok(!markup.includes("2627"), "the answer names the address's season");
    assert.deepEqual(
      linksIn(markup).filter((link) => link.href.startsWith("/bereich")),
      [{ href: `/bereich/team/${TEAM_A}/2526`, text: "Goethe-Gymnasium, Saison 2526" }],
    );
  });

  /* A seat on a `past` season grants no panel, so its own team's address answers as held by nobody. */
  it("renders the forbidden panel for a seat on a past season", async () => {
    setSubject(person({ sitze: [sitz({ saison_id: "2425", saison_status: "past" })] }));
    const { markup } = await rendered(TEAM_A, "2425");

    assert.ok(markup.includes(FORBIDDEN_BADGE), "a past season's address renders its panel");
    assert.deepEqual(
      linksIn(markup).filter((link) => link.href.startsWith("/bereich")),
      [{ href: "/bereich", text: "Zu Deinem Bereich" }],
    );
  });

  /* One way out per team and season: a Trainer who is also the Ansprechperson holds one panel there. */
  it("offers one way out per address the person holds a seat at", async () => {
    setSubject(
      person({
        sitze: [sitz({ rolle: "trainer" }), sitz({ rolle: "ansprechperson" }), sitz({ saison_id: "2627", saison_status: "future" })],
      }),
    );
    const { markup } = await rendered(TEAM_B, "2526");

    assert.deepEqual(
      linksIn(markup)
        .filter((link) => link.href.startsWith("/bereich"))
        .map((link) => link.href),
      [`/bereich/team/${TEAM_A}/2526`, `/bereich/team/${TEAM_A}/2627`],
    );
  });
});
