import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { person, sitz, SITZ } from "@/core/subjectFixtures.ts";
import { filesUnder } from "@/core/treeWalk.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import {
  answer,
  answerReadsWith,
  backendNotFound,
  clearSteps,
  EMPTIEST_ANSWER,
  prerenderShell,
  readsOf,
  renderPage,
  steps,
} from "@/shared/testing/pageHarness.ts";
import { textOf } from "@/shared/testing/renderTest.ts";

import type { SubjectSession } from "@/core/subject.ts";
import type { ReactElement, ReactNode } from "react";

const { setSession, setSubject } = doubleActionRequest();

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step and the doubles as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: PersoenlichLayout } = await import("@/app/bereich/(persoenlich)/layout.tsx");
const { default: TeamLayout } = await import("@/app/bereich/team/[team_id]/[saison_id]/layout.tsx");
const { default: AdminLayout } = await import("@/app/bereich/admin/layout.tsx");
const { default: DashboardLayout } = await import("@/app/dashboard/layout.tsx");
const { KONTO_HREF } = await import("@/core/kontoHref.ts");

const APP_DIR = path.resolve(import.meta.dirname, "..");
const TEAM = { team_id: SITZ.team_id, saison_id: "2526" };
const TEAM_HREF = `/bereich/team/${TEAM.team_id}/${TEAM.saison_id}`;

/** What stands in each layout's page slot, which the layout holds back until the session is read. */
const PAGE = "Seiteninhalt";

/** A person holding every place, so whatever the session decides shows once it is read. */
const EVERY_PLACE = person(
  { sitze: [sitz()], spieler: [{ spieler_id: SITZ.team_id }], schiedsrichter: [{ schiedsrichter_id: SITZ.team_id }] },
  true,
);

/** The same person seated at another team only, so the team address they stand at is refused. */
const SEATED_ELSEWHERE = person(
  {
    sitze: [sitz({ team_id: "6890a1b2c3d4e5f607250012", team_name: "Lessing-Gymnasium" })],
    spieler: [{ spieler_id: SITZ.team_id }],
    schiedsrichter: [{ schiedsrichter_id: SITZ.team_id }],
  },
  true,
);

answerReadsWith((endpoint, schema, params) => {
  // The administrator's own records hold a seat too, so the admin area's switcher has a second place to offer.
  if (endpoint === "/identitaet/subjekt") return answer(schema, endpoint, { sitze: [sitz()] });
  // Between seasons, which the dashboard's slot answers with the list alone.
  if (endpoint === "/saisons/current") throw backendNotFound(endpoint);
  return EMPTIEST_ANSWER(endpoint, schema, params);
});

/** The page's one heading, read as a screen reader names it. */
function headingIn(markup: string): string {
  const found = [...markup.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)];
  assert.equal(found.length, 1, `the shell holds ${String(found.length)} h1 elements`);
  return textOf(found[0]?.[1] ?? "", " ").trim();
}

const hrefsIn = (markup: string): string[] => [...markup.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map(([, href]) => href!);

/**
 * What a reader meets in markup: its words, joined as they read where React splits one text into several nodes
 * with an empty comment between them, and every name an `aria-label` gives a control whose own words say less.
 */
function readIn(markup: string): string {
  const names = [...markup.matchAll(/\saria-label="([^"]*)"/g)].map(([, name]) => name!);
  return [textOf(markup.replaceAll("<!-- -->", ""), " "), ...names].join(" ").replace(/\s+/g, " ");
}

type Frame = {
  name: string;
  layout: ReactElement;
  pathname: string;
  params?: Record<string, string>;
  /** Who the session's subject is. */
  subject: SubjectSession;
  /** What the bar heads the address with before anything is read. */
  heading: string;
  /** Whether a session stands behind the area, which the bar's account controls say. */
  signedIn: boolean;
  /**
   * What the request decides, which the shell must hold back until it is read: the words and links the subject
   * is shown, and the backend reads made for them. Each one shows once the request is read.
   */
  waits: { text: string[]; hrefs: string[]; reads: string[] };
};

const FRAMES: Frame[] = [
  {
    name: "the person area",
    layout: h(PersoenlichLayout, { children: h("p", null, PAGE) }),
    pathname: "/bereich",
    subject: EVERY_PLACE,
    heading: "Übersicht",
    signedIn: true,
    // The landing's entry stands in for the rest, every person holding it.
    waits: { text: ["Funktion wechseln", PAGE], hrefs: ["/bereich/spieler", "/bereich/schiedsrichter"], reads: [] },
  },
  {
    name: "the team area",
    layout: h(TeamLayout, { params: Promise.resolve(TEAM), children: h("p", null, PAGE) }),
    pathname: TEAM_HREF,
    params: TEAM,
    subject: EVERY_PLACE,
    heading: "Übersicht",
    signedIn: true,
    waits: { text: ["Funktion wechseln", "Saison 2526", PAGE], hrefs: [TEAM_HREF, `${TEAM_HREF}/kader`], reads: [] },
  },
  {
    name: "the team area refused",
    layout: h(TeamLayout, { params: Promise.resolve(TEAM), children: h("p", null, PAGE) }),
    pathname: TEAM_HREF,
    params: TEAM,
    subject: SEATED_ELSEWHERE,
    heading: "Übersicht",
    signedIn: true,
    // The refusal heads the bar with the area's name and fills the page's slot with the forbidden panel.
    waits: { text: ["Teambereich", "Tribüne"], hrefs: [], reads: [] },
  },
  {
    name: "the admin area",
    layout: h(AdminLayout, { children: h("p", null, PAGE) }),
    pathname: "/bereich/admin/teams",
    subject: EVERY_PLACE,
    heading: "Teams",
    signedIn: true,
    waits: { text: ["Funktion wechseln", PAGE], hrefs: [], reads: ["/identitaet/subjekt", "/saisons/list/admin"] },
  },
  {
    name: "the dashboard",
    layout: h(DashboardLayout, { children: h("p", null, PAGE) }),
    pathname: "/dashboard/spielplan",
    subject: EVERY_PLACE,
    heading: "Spielplan",
    signedIn: false,
    // No session stands behind it, and its season selector renders the slot's own placeholder until it
    // hydrates: what waits is the season slot's reads alone.
    waits: { text: [], hrefs: [], reads: ["/saisons/current", "/saisons"] },
  },
];

/** What `render` makes of `frame`'s layout for its subject, and every backend read made on the way. */
async function rendered(frame: Frame, render: (tree: ReactNode) => Promise<string>): Promise<{ markup: string; reads: string[] }> {
  // In the case and not where the cases are declared: `doubleActionRequest`'s own hook resets both before every case.
  setSession({ user: { email: frame.subject.email } }, "/bereich");
  setSubject(frame.subject);
  clearSteps();
  const markup = await render(underNext(frame.layout, { pathname: frame.pathname, ...(frame.params ? { params: frame.params } : {}) }));

  return { markup: markup, reads: readsOf(steps).map(({ endpoint }) => endpoint) };
}

/* `underNext` hands each frame a request's address. A route a segment parameter names is built with none, so
   an address read outside a boundary fails `next build`, which holds that half of `docs/frontend/spec.md :: I735`. */
describe("each area's frame before the request is read, at an address it is handed (`docs/frontend/spec.md :: I735`)", () => {
  for (const frame of FRAMES) {
    /* The bar is what the reader keeps across a navigation into the area: painted only once the session is
       read, it vanishes for that long, and a document load paints the area with no bar at all. */
    it(`paints ${frame.name}'s bar and its heading before the request is read`, async () => {
      const { markup } = await rendered(frame, prerenderShell);

      assert.ok(markup.includes("<header"), `${frame.name}'s shell holds no bar`);
      assert.equal(headingIn(markup), frame.heading, `${frame.name}'s bar heads the address otherwise`);
      assert.equal(markup.includes('aria-label="Abmelden"'), frame.signedIn, `${frame.name}'s bar offers the sign-out otherwise`);
      assert.equal(hrefsIn(markup).includes(KONTO_HREF), frame.signedIn, `${frame.name}'s bar links the account page otherwise`);
    });

    /* Painted before the read, a part the session decides shows a person what their session may not hold. */
    it(`holds back what the session decides in ${frame.name}`, async () => {
      const { markup, reads } = await rendered(frame, prerenderShell);
      const read = readIn(markup);

      for (const waits of frame.waits.text) assert.ok(!read.includes(waits), `${frame.name}'s shell shows „${waits}“ before the request`);
      for (const href of frame.waits.hrefs)
        assert.ok(!hrefsIn(markup).includes(href), `${frame.name}'s shell links ${href} before the request`);
      assert.deepEqual(reads, [], `${frame.name}'s shell reads the backend before the request`);
    });

    /* The control: the absences above pass over a word no render of this subject shows, and over a read
       made where the case does not look. */
    it(`shows what it held back in ${frame.name} once the request is read`, async () => {
      const { markup, reads } = await rendered(frame, renderPage);
      const read = readIn(markup);

      for (const waits of frame.waits.text) assert.ok(read.includes(waits), `${frame.name} never shows „${waits}“`);
      for (const href of frame.waits.hrefs) assert.ok(hrefsIn(markup).includes(href), `${frame.name} never links ${href}`);
      assert.deepEqual(reads.toSorted(), frame.waits.reads.toSorted(), `${frame.name} reads the backend otherwise`);
    });
  }
});

describe("the loading boundaries above the areas (`docs/frontend/spec.md :: I736`)", () => {
  /* Next mounts a `loading.tsx` new wherever a navigation enters its segment, and React shows a new
     boundary's fallback at once: one above an area's layout replaces that area's bar for the whole wait. */
  it("stand nowhere above an area's own layout", () => {
    const nested = filesUnder(APP_DIR, (name) => name === "layout.tsx", 6).filter((file) => path.dirname(file) !== APP_DIR);
    // The outermost on each branch: one nested in an area sits below the area's own `loading.tsx` by design.
    const layouts = nested.filter((file) => !nested.some((other) => other !== file && file.startsWith(path.dirname(other) + path.sep)));
    // The control: an empty walk passes the absence below unread.
    assert.ok(layouts.length >= 5, `the walk found ${String(layouts.length)} area layouts`);

    for (const layout of layouts) {
      for (let dir = path.dirname(path.dirname(layout)); dir.startsWith(APP_DIR); dir = path.dirname(dir)) {
        assert.ok(
          !existsSync(path.join(dir, "loading.tsx")),
          `${path.relative(APP_DIR, path.join(dir, "loading.tsx"))} stands above ${path.relative(APP_DIR, layout)}`,
        );
        if (dir === APP_DIR) break;
      }
    }
  });
});
