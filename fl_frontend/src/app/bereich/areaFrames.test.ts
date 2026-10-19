import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { person, sitz, SITZ } from "@/core/subjectFixtures.ts";
import { doubleActionRequest, doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { prerenderShell } from "@/shared/testing/pageHarness.ts";
import { textOf } from "@/shared/testing/renderTest.ts";

import type { ReactElement } from "react";

const { setSession, setSubject } = doubleActionRequest();
// Each shell hands a sign-out action to the bar, whose real module reaches `next/server` past the harness.
doubleEveryAction();

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step and the doubles as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: PersoenlichLayout } = await import("@/app/bereich/(persoenlich)/layout.tsx");
const { default: TeamLayout } = await import("@/app/bereich/team/[team_id]/[saison_id]/layout.tsx");
const { default: AdminLayout } = await import("@/app/bereich/admin/layout.tsx");
const { default: DashboardLayout } = await import("@/app/dashboard/layout.tsx");
const { KONTO_HREF } = await import("@/core/kontoHref.ts");

const TEAM = { team_id: SITZ.team_id, saison_id: "2526" };
const TEAM_HREF = `/bereich/team/${TEAM.team_id}/${TEAM.saison_id}`;

/** What stands in each layout's page slot, which the session's guard holds back. */
const PAGE = "Seiteninhalt";

/** The page's one heading, read as a screen reader names it. */
function headingIn(markup: string): string {
  const found = [...markup.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
  assert.equal(found.length, 1, `the shell holds ${String(found.length)} h1 elements`);
  return textOf(found[0]?.[1] ?? "", " ").trim();
}

const hrefsIn = (markup: string): string[] => [...markup.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map(([, href]) => href!);

type Frame = {
  name: string;
  layout: ReactElement;
  pathname: string;
  params?: Record<string, string>;
  /** What the bar heads the address with before anything is read. */
  heading: string;
  /** Whether a session stands behind the area, which the bar's account controls say. */
  signedIn: boolean;
  /** Text and links the session decides, which the shell must hold back until the request is read. */
  waits: { text: string[]; hrefs: string[] };
};

const FRAMES: Frame[] = [
  {
    name: "the person area",
    layout: h(PersoenlichLayout, { children: h("p", null, PAGE) }),
    pathname: "/bereich",
    heading: "Übersicht",
    signedIn: true,
    // The landing's entry stands in for the rest, every person holding it.
    waits: { text: ["Funktion wechseln", PAGE], hrefs: ["/bereich/spieler", "/bereich/schiedsrichter"] },
  },
  {
    name: "the team area",
    layout: h(TeamLayout, { params: Promise.resolve(TEAM), children: h("p", null, PAGE) }),
    pathname: TEAM_HREF,
    params: TEAM,
    heading: "Übersicht",
    signedIn: true,
    waits: { text: ["Funktion wechseln", "Saison 2526", "Tribüne", PAGE], hrefs: [TEAM_HREF, `${TEAM_HREF}/kader`] },
  },
  {
    name: "the admin area",
    layout: h(AdminLayout, { children: h("p", null, PAGE) }),
    pathname: "/bereich/admin/teams",
    heading: "Teams",
    signedIn: true,
    waits: { text: ["Funktion wechseln", PAGE], hrefs: [] },
  },
  {
    name: "the dashboard",
    layout: h(DashboardLayout, { children: h("p", null, PAGE) }),
    pathname: "/dashboard/spielplan",
    heading: "Spielplan",
    signedIn: false,
    // No session stands behind it: only the season slot reads the request.
    waits: { text: ["Saison 2526"], hrefs: [] },
  },
];

describe("each area's frame in the build's static shell (`docs/frontend/spec.md :: I735`)", () => {
  /* A person holding every place, so whatever the session decides would show if it were read: an absence
     below is the frame not waiting on the request, never a session that holds nothing. */
  setSession({ user: { email: "pia@example.org" } }, "/bereich");
  setSubject(person({ sitze: [sitz()], spieler: [{ spieler_id: SITZ.team_id }], schiedsrichter: [{ schiedsrichter_id: SITZ.team_id }] }, true));

  for (const frame of FRAMES) {
    /* The bar is what the reader keeps across a navigation into the area: painted only once the session is
       read, it vanishes for that long, and a document load paints the area with no bar at all. */
    it(`paints ${frame.name}'s bar and its heading before the request is read`, async () => {
      const markup = await prerenderShell(
        underNext(frame.layout, { pathname: frame.pathname, ...(frame.params ? { params: frame.params } : {}) }),
      );

      assert.ok(markup.includes("<header"), `${frame.name}'s shell holds no bar`);
      assert.equal(headingIn(markup), frame.heading, `${frame.name}'s bar heads the address otherwise`);
      assert.equal(markup.includes('aria-label="Abmelden"'), frame.signedIn, `${frame.name}'s bar offers the sign-out otherwise`);
      assert.equal(hrefsIn(markup).includes(KONTO_HREF), frame.signedIn, `${frame.name}'s bar links the account page otherwise`);
    });

    /* Painted before the read, a part the session decides shows a person what their session may not hold. */
    it(`holds back what the session decides in ${frame.name}`, async () => {
      const markup = await prerenderShell(
        underNext(frame.layout, { pathname: frame.pathname, ...(frame.params ? { params: frame.params } : {}) }),
      );
      const text = textOf(markup, " ");

      for (const waits of frame.waits.text) assert.ok(!text.includes(waits), `${frame.name}'s shell shows „${waits}“ before the request`);
      for (const href of frame.waits.hrefs)
        assert.ok(!hrefsIn(markup).includes(href), `${frame.name}'s shell links ${href} before the request`);
    });
  }
});
