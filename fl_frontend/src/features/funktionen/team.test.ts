import "@/shared/testing/dom.ts";

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { APIBadStatusError } from "@/core/errors.ts";
import { person, sitz, SITZ } from "@/core/subjectFixtures.ts";
import { filesUnder } from "@/core/treeWalk.ts";
import { doubleEveryAction, doubleSubjectLookup } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import {
  answerReadsWith,
  callPage,
  clearSteps,
  EMPTIEST_ANSWER,
  pageBody,
  readsOf,
  redirectTarget,
  renderPage,
  steps,
} from "@/shared/testing/pageHarness.ts";
import { textOf } from "@/shared/testing/renderTest.ts";

import type { ReactNode } from "react";

const { setSubject } = doubleSubjectLookup();
// The shell hands a sign-out action to the bar, whose real module reaches `next/server` past the harness.
doubleEveryAction();

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step and the doubles as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: TeamLayout } = await import("@/app/bereich/team/[team_id]/[saison_id]/layout.tsx");
const { default: TeamStartPage } = await import("@/app/bereich/team/[team_id]/[saison_id]/page.tsx");
const { default: KaderPage } = await import("@/app/bereich/team/[team_id]/[saison_id]/kader/page.tsx");
const { default: KaderZeilePage } = await import("@/app/bereich/team/[team_id]/[saison_id]/kader/[spieler_id]/page.tsx");
const { KONTO_HREF } = await import("@/core/kontoHref.ts");
const { TEAM_SHELL_FALLBACK, TEAM_SHELL_REFUSAL } = await import("@/features/funktionen/constants.ts");
const { KADER_LEER, NUMMER_DOPPELT, ausgetragenSeit } = await import("@/features/spieler/constants.ts");
const { Angabe } = await import("@/shared/components/ui/Angabe.tsx");

const TEAM_A = SITZ.team_id;
const TEAM_B = "6890a1b2c3d4e5f607250012";

/** The landing's one read: the three seats of the address's team and season. */
const SITZE_ENDPOINT = `/teams/${TEAM_A}/saisons/2526/person/sitze`;

const TEAM_DIR = path.resolve(import.meta.dirname, "..", "..", "app", "bereich", "team", "[team_id]", "[saison_id]");

/** Every page under the team area, read off the tree; the catch-all answers not-found for everyone. */
const TEAM_PAGES = filesUnder(TEAM_DIR, (name) => name === "page.tsx", 3).filter(
  (file) => !/^\[\.\.\..+\]$/.test(path.basename(path.dirname(file))),
);

/** Every layout under the team area, the area's own among them, which is the floor. */
const TEAM_LAYOUTS = filesUnder(TEAM_DIR, (name) => name === "layout.tsx", 1);

/** Team A's address this season, which the person below holds nothing on. */
const HELD_BY_NOBODY = { params: Promise.resolve({ team_id: TEAM_A, saison_id: "2526" }), searchParams: Promise.resolve({}) };

/** The landing as the team area mounts it at one address: under its layout, whose guard runs first. */
const landingAt = (teamId: string, saisonId: string) => {
  const params = Promise.resolve({ team_id: teamId, saison_id: saisonId });

  return () => h(TeamLayout, { params: params, children: h(TeamStartPage, { params: params, searchParams: Promise.resolve({}) }) });
};

/**
 * What a browser holds once the landing's stream at that address has run, arrived at with a season in
 * its query as a link from the admin's or the dashboard's shell carries one.
 */
async function rendered(teamId: string, saisonId: string): Promise<{ markup: string; text: string; reads: string[] }> {
  clearSteps();
  const markup = await renderPage(
    underNext(h(landingAt(teamId, saisonId)), { pathname: `/bereich/team/${teamId}/${saisonId}`, search: `saison_id=${saisonId}` }),
  );

  return { markup: markup, text: textOf(markup, " ").replace(/\s+/g, " "), reads: readsOf(steps).map(({ endpoint }) => endpoint) };
}

/** The page's one heading, which the shell's top bar carries. */
const heading = (markup: string): string => textOf(/<h1[^>]*>([\s\S]*?)<\/h1>/.exec(markup)?.[1] ?? "", " ").trim();

/** Every link the markup offers, as its href and its visible text. */
const linksIn = (markup: string): { href: string; text: string }[] =>
  [...markup.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, inner]) => ({
    href: href!,
    text: textOf(inner!, " ").replace(/\s+/g, " ").trim(),
  }));

/** The ways out the forbidden panel offers: every link into the areas but the shell's own account link, which every signed-in shell carries. */
const wayOutsIn = (markup: string): { href: string; text: string }[] =>
  linksIn(markup).filter((link) => link.href.startsWith("/bereich") && link.href !== KONTO_HREF);

const FORBIDDEN_BADGE = "Tribüne";

describe("the guard over a team's area", () => {
  /* The layout's own turn-away, over a child that redirects nothing: under a page, the page's own
     redirect would pass this case with the layout's gone. */
  it("sends a request with no person's session to sign in", async () => {
    setSubject(null);
    const layoutAlone = () =>
      h(TeamLayout, { params: Promise.resolve({ team_id: TEAM_A, saison_id: "2526" }), children: h("p", null, "Seite") });
    const { thrown } = await callPage(layoutAlone, { params: Promise.resolve({}), searchParams: Promise.resolve({}) });

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
    const { markup, text, reads } = await rendered(TEAM_A, "2526");

    assert.deepEqual(reads, [SITZE_ENDPOINT], "the landing reads anything but its own team's seats, or the shell reads at all");
    assert.ok(markup.includes("data-app-shell"), "the landing renders outside the team shell");
    assert.equal(heading(markup), "Übersicht");
    assert.match(markup, /<h2[^>]*>Goethe-Gymnasium<\/h2>/, "the landing's heading does not name the team");
    assert.ok(text.includes("Du bist hier als Ansprechperson und Trainerin oder Trainer eingetragen."), text);
    assert.ok(!markup.includes(FORBIDDEN_BADGE), "a seat holder is shown the forbidden panel");
  });

  /* The season is the address's own segment, so the chip names it and no link repeats it as a query. */
  it("names the address's season in the shell and carries it on no link as a query", async () => {
    setSubject(person({ sitze: [sitz()] }));
    const { markup, text, reads } = await rendered(TEAM_A, "2526");

    assert.deepEqual(reads, [SITZE_ENDPOINT], "the landing reads anything but its own team's seats, or the shell reads at all");
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
  /* The page alone, as Next runs it whatever the layout renders in its stead: the seat check is the
     page's own, before any read, or the page's data reaches the payload beside the forbidden panel. */
  it("renders nothing from the page itself, which checks the seat on its own", async () => {
    const page = (teamId: string) =>
      h(TeamStartPage, { params: Promise.resolve({ team_id: teamId, saison_id: "2526" }), searchParams: Promise.resolve({}) });
    setSubject(person({ sitze: [sitz()] }));

    // The control: at the held address the same page renders the team, so the empty answer is the check's.
    assert.ok((await renderPage(underNext(page(TEAM_A)))).includes("Goethe-Gymnasium"), "the page renders nothing even where a seat stands");
    assert.equal(await renderPage(underNext(page(TEAM_B))), "", "the page renders for an address the person holds no seat on");
  });

  /* Every team page, a page added tomorrow included: one that reads before it checks the seat puts that
     read's data in the payload beside the forbidden panel. */
  it("renders nothing and reads nothing from any team page at an address held by nobody there", async () => {
    setSubject(person({ sitze: [sitz({ team_id: TEAM_B, team_name: "Lessing-Gymnasium" })] }));

    for (const file of TEAM_PAGES) {
      const { default: Page } = (await import(pathToFileURL(file).href)) as { default: (props: typeof HELD_BY_NOBODY) => ReactNode };
      clearSteps();
      const markup = await renderPage(underNext(h(Page, HELD_BY_NOBODY)));

      assert.equal(markup, "", `${path.relative(TEAM_DIR, file)} renders at an address the person holds no seat on`);
      assert.deepEqual(readsOf(steps), [], `${path.relative(TEAM_DIR, file)} reads before it checks the seat`);
    }
  });

  /* A lost seat alone answers the forbidden panel: a page reading every other failure as one tells a
     seat holder whose backend fell over that they hold no seat there. */
  it("throws a failed read from every team page to the area's boundary, never answering it as a lost seat", async () => {
    setSubject(person({ sitze: [sitz()] }));
    const props = { params: Promise.resolve({ team_id: TEAM_A, saison_id: "2526", spieler_id: LENA }), searchParams: Promise.resolve({}) };

    for (const file of TEAM_PAGES) {
      const { default: Page } = (await import(pathToFileURL(file).href)) as { default: (props: unknown) => ReactNode };
      const failure = new APIBadStatusError({
        message: "failed",
        url: "http://backend/api/v0/any",
        statusCode: 500,
        endpoint: "/any",
        method: "GET",
        readOnly: true,
        traceId: "0",
      });
      answerReadsWith(() => {
        throw failure;
      });
      try {
        const { thrown } = await callPage(Page, props);

        assert.deepEqual(thrown, [failure], `${path.relative(TEAM_DIR, file)} answers a failed read as something other than a failure`);
      } finally {
        answerReadsWith(EMPTIEST_ANSWER);
      }
    }
  });

  /* Next runs a nested layout whatever the area's layout renders in its stead, as it runs a page: one
     reading before it checks the seat puts that read's data in the payload beside the forbidden panel. */
  it("reads nothing from any team layout at an address held by nobody there", async () => {
    setSubject(person({ sitze: [sitz({ team_id: TEAM_B, team_name: "Lessing-Gymnasium" })] }));

    for (const file of TEAM_LAYOUTS) {
      const { default: Layout } = (await import(pathToFileURL(file).href)) as {
        default: (props: { params: (typeof HELD_BY_NOBODY)["params"]; children: ReactNode }) => ReactNode;
      };
      clearSteps();
      await renderPage(
        underNext(h(Layout, { params: HELD_BY_NOBODY.params, children: null }), {
          pathname: `/bereich/team/${TEAM_A}/2526`,
          params: { team_id: TEAM_A, saison_id: "2526" },
        }),
      );

      assert.deepEqual(readsOf(steps), [], `${path.relative(TEAM_DIR, file)} reads before it checks the seat`);
    }
  });

  /* Inside the shell, so the person meets their own navigation, and naming nothing of the address: no
     entry, no season, no role, nothing about who holds a seat there or whether the team exists. */
  it("renders the forbidden panel inside the shell for another team, linking to the team the person holds", async () => {
    setSubject(person({ sitze: [sitz()] }));
    // A season the person holds nothing in either, so a mention of it can only be the address's.
    const { markup, text, reads } = await rendered(TEAM_B, "2627");

    assert.deepEqual(reads, [], "the forbidden panel's render reads at an address the person holds no seat on");
    assert.ok(markup.includes("data-app-shell"), "the forbidden panel renders outside the team shell");
    assert.ok(markup.includes(FORBIDDEN_BADGE), "the forbidden panel is not what renders");
    assert.ok(text.includes("Hier bist Du nicht eingetragen."), text);
    assert.ok(!text.includes("Du bist hier als"), "the landing renders behind the forbidden panel");
    assert.ok(!markup.includes(TEAM_B), "the answer names the address's team");
    assert.ok(!markup.includes("2627"), "the answer names the address's season");
    assert.deepEqual(wayOutsIn(markup), [{ href: `/bereich/team/${TEAM_A}/2526`, text: "Goethe-Gymnasium, Saison 2526" }]);
  });

  /* A seat on a `past` season grants no panel, so its own team's address answers as held by nobody. */
  it("renders the forbidden panel for a seat on a past season", async () => {
    setSubject(person({ sitze: [sitz({ saison_id: "2425", saison_status: "past" })] }));
    const { markup, reads } = await rendered(TEAM_A, "2425");

    assert.deepEqual(reads, [], "the forbidden panel's render reads at a past season's address");
    assert.ok(markup.includes(FORBIDDEN_BADGE), "a past season's address renders its panel");
    assert.deepEqual(wayOutsIn(markup), [{ href: "/bereich", text: "Zu Deinem Bereich" }]);
  });

  /* One way out per team and season: a Trainer who is also the Ansprechperson holds one panel there. */
  it("offers one way out per address the person holds a seat at", async () => {
    setSubject(
      person({
        sitze: [sitz({ rolle: "trainer" }), sitz({ rolle: "ansprechperson" }), sitz({ saison_id: "2627", saison_status: "future" })],
      }),
    );
    const { markup, reads } = await rendered(TEAM_B, "2526");

    assert.deepEqual(reads, [], "the forbidden panel's render reads at an address the person holds no seat on");
    assert.deepEqual(
      wayOutsIn(markup).map((link) => link.href),
      [`/bereich/team/${TEAM_A}/2526`, `/bereich/team/${TEAM_A}/2627`],
    );
  });

  /* The layout's own word, where `TeamForbiddenPanel.test.ts` hands the shell its flag: only here does a
     layout that stops telling the shell the address is refused leave the bar calling it a missing page. */
  it("opens the bar's hint on why the person is not entered, never on a missing page", async () => {
    setSubject(person({ sitze: [sitz({ team_id: TEAM_B, team_name: "Lessing-Gymnasium" })] }));
    const params = { team_id: TEAM_A, saison_id: "2526" };
    // The guard, then the chrome, each called as Next calls it; what the chrome returns is the browser's to render.
    const guarded = await pageBody(TeamLayout, { params: Promise.resolve(params), children: h("p", null, "Seite") });
    const shell = await pageBody(() => guarded, {});
    render(underNext(shell, { pathname: `/bereich/team/${TEAM_A}/2526`, params: params }));
    await userEvent.setup().click(screen.getByRole("button", { name: `Was auf „${TEAM_SHELL_FALLBACK.label}“ zu finden ist` }));
    const shown = document.body.textContent;

    assert.ok(shown.includes(TEAM_SHELL_REFUSAL.hint.lead), "the bar over the forbidden panel does not say the person is not entered");
    assert.ok(!shown.includes(TEAM_SHELL_FALLBACK.hint.lead), "the bar over the forbidden panel reads as a missing page");
  });
});

const LENA = "68c1f0a2b3c4d5e6f7a8b931";
const MIA = "68c1f0a2b3c4d5e6f7a8b932";
const NOAH = "68c1f0a2b3c4d5e6f7a8b933";
const AUSGETRAGEN_AM = "2026-03-01";

/** One squad row as the backend serves it to a seat holder. */
const zeile = (spieler_id: string, vorname: string, nachname: string, fields: Record<string, unknown> = {}) => ({
  spieler_id,
  vorname,
  nachname,
  nummer: "7",
  position: "Tor",
  stufe: "Q1",
  rolle: null,
  ist_nachnominiert: false,
  inactive_since: null,
  nummer_doppelt: true,
  // Never served: written here so the cases below prove the page carries nothing of the kind on.
  email: "lena@example.org",
  telefon: "0151 2345678",
  ...fields,
});

/** Team A's squad this season: two live rows sharing one shirt, a captain among them, and one ausgetragen row. */
const KADER = {
  acknowledged: 1,
  team_id: TEAM_A,
  saison_id: "2526",
  erlaubte_stufen: ["Q2", "E1"],
  kader: [
    zeile(LENA, "Lena", "Meier-Lüdenscheid", { rolle: "kapitaen", ist_nachnominiert: true }),
    zeile(MIA, "Mia", "Schmidt"),
    zeile(NOAH, "Noah", "Becker", { nummer: "9", nummer_doppelt: false, inactive_since: AUSGETRAGEN_AM }),
  ],
};

const KADER_ENDPOINT = `/spieler/kader/${TEAM_A}/2526`;
const KADER_HREF = `/bereich/team/${TEAM_A}/2526/kader`;

/** The backend's answer to a read naming a seat it does not find held. */
const seatLost = (endpoint: string) =>
  new APIBadStatusError({
    message: "refused",
    url: `http://backend/api/v0${endpoint}`,
    statusCode: 403,
    serverErrorCode: "REQ-FUNKTION-001",
    endpoint: endpoint,
    method: "GET",
    readOnly: true,
    traceId: "0",
  });

/** The squad read answered with `kader`, every other read with the emptiest body. */
const answeringKader = (kader: unknown) =>
  answerReadsWith((endpoint, schema, params) => (endpoint === KADER_ENDPOINT ? kader : EMPTIEST_ANSWER(endpoint, schema, params)));

/** What a browser holds once one of the squad's pages has run at team A this season, and what it read. */
async function renderedKader(spielerId?: string): Promise<{ markup: string; text: string; reads: string[] }> {
  const address = { team_id: TEAM_A, saison_id: "2526" };
  const searchParams = Promise.resolve({});
  clearSteps();
  const page =
    spielerId === undefined
      ? h(KaderPage, { params: Promise.resolve(address), searchParams })
      : h(KaderZeilePage, { params: Promise.resolve({ ...address, spieler_id: spielerId }), searchParams });
  const markup = await renderPage(underNext(page, { pathname: spielerId === undefined ? KADER_HREF : `${KADER_HREF}/${spielerId}` }));

  return { markup, text: textOf(markup, " ").replace(/\s+/g, " "), reads: readsOf(steps).map(({ endpoint }) => endpoint) };
}

/** Every key at any depth of `value`, which is what a payload handed a page or a component could carry on. */
const keysOf = (value: unknown): string[] =>
  typeof value !== "object" || value === null ? [] : Object.entries(value).flatMap(([key, inner]) => [key, ...keysOf(inner)]);

/** A key naming a way to reach a person, in either language. */
const CONTACT_KEY = /mail|telefon|phone/i;

describe("the team's squad, as a seat holder reads it", () => {
  /* A Trainer-only seat, the narrowest there is: whatever an Ansprechperson reads, it reads too. */
  it("lists every row with its whole surname, the shirt marker on both rows of a pair, and each live row's editor", async () => {
    setSubject(person({ sitze: [sitz({ rolle: "trainer" })] }));
    answeringKader(KADER);
    try {
      const { markup, text, reads } = await renderedKader();

      assert.deepEqual(reads, [KADER_ENDPOINT]);
      for (const name of ["Lena Meier-Lüdenscheid", "Mia Schmidt", "Noah Becker"])
        assert.ok(text.includes(name), `${name} is not listed whole`);
      assert.equal(text.split(NUMMER_DOPPELT).length - 1, 2, "the shirt marker is not on exactly the two rows sharing a number");
      assert.ok(text.includes("Kapitän") && text.includes("Nachnominiert"), text);
      assert.ok(text.includes(ausgetragenSeit(AUSGETRAGEN_AM)), "the ausgetragen row does not say since when");
      assert.deepEqual(
        linksIn(markup)
          .map((link) => link.href)
          .filter((href) => href.startsWith(KADER_HREF)),
        [`${KADER_HREF}/${LENA}`, `${KADER_HREF}/${MIA}`],
        "an ausgetragen row offers its editor, or a live row offers none",
      );
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });

  /* The squad's answer carries an address and a number here, as a backend leak would: the page's
     schema is what keeps either off the page and out of every prop a client component is handed. */
  it("carries no way to reach a pupil, in the markup or in what the page hands its components", async () => {
    setSubject(person({ sitze: [sitz()] }));
    answeringKader(KADER);
    try {
      const { markup } = await renderedKader();
      const listed = await pageBody(KaderPage, {
        params: Promise.resolve({ team_id: TEAM_A, saison_id: "2526" }),
        searchParams: Promise.resolve({}),
      });
      const editing = await pageBody(KaderZeilePage, {
        params: Promise.resolve({ team_id: TEAM_A, saison_id: "2526", spieler_id: LENA }),
        searchParams: Promise.resolve({}),
      });

      assert.ok(!markup.includes("@") && !markup.includes("0151"), "the squad page renders a pupil's address or number");
      for (const [page, element] of [
        ["the squad page", listed],
        ["the row's page", editing],
      ] as const) {
        assert.deepEqual(
          keysOf(element.props).filter((key) => CONTACT_KEY.test(key)),
          [],
          `${page} hands a component a way to reach a pupil`,
        );
      }
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });

  /* The registrations are the one way a pupil reaches the squad from the seat holder's side, so the empty
     squad points there. */
  it("says no squad is entered yet where the season holds none, and links to the team's registrations", async () => {
    setSubject(person({ sitze: [sitz()] }));
    answeringKader({ ...KADER, kader: [] });
    try {
      const { markup, text } = await renderedKader();
      document.body.innerHTML = markup;
      // The panel the empty sentence stands in, so a link beside it rather than in it fails.
      const panel = [...document.querySelectorAll("p")].find((p) => p.textContent === KADER_LEER)?.parentElement;

      assert.ok(text.includes(KADER_LEER), text);
      assert.deepEqual(
        [...(panel?.querySelectorAll("a") ?? [])].map((link) => [link.getAttribute("href"), link.textContent]),
        [[`/bereich/team/${TEAM_A}/2526/registrierungen`, "Zu den Registrierungen"]],
        "the empty squad's panel links nowhere a pupil comes from",
      );
      document.body.innerHTML = "";
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });

  /* As text in the chip and never an `aria-label`, which a screen reader ignores on a span with no role:
     in the words the pupil's own page uses for the same absence. */
  it("names a row with no number as the pupil's own page does, in text", async () => {
    setSubject(person({ sitze: [sitz()] }));
    answeringKader({ ...KADER, kader: [zeile(MIA, "Mia", "Schmidt", { nummer: null, nummer_doppelt: false })] });
    try {
      const { markup, text } = await renderedKader();

      assert.ok(text.includes("Ohne Nummer"), text);
      assert.ok(!/aria-label="[^"]*Nummer/.test(markup), "the chip names its absence where no screen reader reads it");
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });

  /* The page's own check found the seat and the backend's, a moment later, did not: the page answers as
     the shell does for a seat not held, rather than as a crash. */
  for (const spielerId of [undefined, LENA]) {
    it(`renders the forbidden panel where the seat went between the check and the read, on the ${spielerId === undefined ? "squad" : "row's"} page`, async () => {
      setSubject(person({ sitze: [sitz()] }));
      answerReadsWith((endpoint, schema, params) => {
        if (endpoint === KADER_ENDPOINT) throw seatLost(endpoint);
        return EMPTIEST_ANSWER(endpoint, schema, params);
      });
      try {
        const { markup, text } = await renderedKader(spielerId);

        assert.ok(markup.includes(FORBIDDEN_BADGE) && text.includes("Hier bist Du nicht eingetragen."), text);
        assert.ok(!text.includes(KADER_LEER) && !text.includes("Lena"), "the squad renders beside the forbidden panel");
      } finally {
        answerReadsWith(EMPTIEST_ANSWER);
      }
    });
  }
});

describe("one squad row, as a seat holder opens it", () => {
  it("opens a live row in its editor, the austragen beside the four fields", async () => {
    setSubject(person({ sitze: [sitz({ rolle: "trainer" })] }));
    answeringKader(KADER);
    try {
      const { markup, text } = await renderedKader(LENA);

      assert.match(markup, /<h2[^>]*>Lena Meier-Lüdenscheid<\/h2>/, "the editor is not headed by the pupil's whole name");
      assert.ok(markup.includes('name="nummer"'), "the editor renders no number field");
      assert.ok(text.includes("Aus Kader 2526 austragen"), text);
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });

  /* Read-only: the representative's austragen is one-way, the administrator's reactivate the way back. */
  it("opens an ausgetragen row read-only, with its day and neither an editor nor an austragen", async () => {
    setSubject(person({ sitze: [sitz()] }));
    answeringKader(KADER);
    try {
      const { markup, text } = await renderedKader(NOAH);

      assert.ok(text.includes(ausgetragenSeit(AUSGETRAGEN_AM)), text);
      assert.ok(!markup.includes('name="nummer"'), "an ausgetragen row renders its editor");
      assert.ok(!text.includes("austragen"), "an ausgetragen row offers the austragen again");

      // Each fact in the one stored-fact pair every other page renders, read off a rendered `Angabe`.
      const angabe = await renderPage(h("dl", null, h(Angabe, { label: "Nummer", children: "9" })));
      const dtOf = (html: string) => [...html.matchAll(/<dt class="([^"]*)">([^<]*)<\/dt>/g)].map(([, classes, label]) => [label, classes]);
      const [[, angabeClasses] = []] = dtOf(angabe);
      assert.deepEqual(
        dtOf(markup),
        ["Nummer", "Position", "Stufe", "Rolle"].map((label) => [label, angabeClasses]),
        "the ausgetragen row's facts are not the shared stored-fact pair",
      );
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });

  it("answers a pupil the squad does not hold with the area's 404", async () => {
    setSubject(person({ sitze: [sitz()] }));
    answeringKader(KADER);
    try {
      const { thrown } = await callPage(KaderZeilePage, {
        params: Promise.resolve({ team_id: TEAM_A, saison_id: "2526", spieler_id: "68c1f0a2b3c4d5e6f7a8b9ff" }),
        searchParams: Promise.resolve({}),
      });

      assert.ok(thrown.some((error) => (error as { digest?: unknown } | null)?.digest === "NEXT_HTTP_ERROR_FALLBACK;404"));
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });
});

/** The three seats as the backend serves them, carrying an address and a number as a leak would. */
const SITZE = {
  acknowledged: 1,
  team_id: TEAM_A,
  saison_id: "2526",
  sitze: [
    { rolle: "trainer", name: "Tom Becker", bestaetigt: false, email: "tom@sitz.invalid", telefon: "0151 2345678" },
    { rolle: "ansprechperson", name: "Pia Klein", bestaetigt: true, kontakt: { email: "klein@sitz.invalid" } },
    { rolle: "stellvertretung", name: null, bestaetigt: false },
  ],
};

/** The seat read answered with `sitze`, every other read with the emptiest body. */
const answeringSitze = (sitze: unknown = SITZE) =>
  answerReadsWith((endpoint, schema, params) => (endpoint === SITZE_ENDPOINT ? sitze : EMPTIEST_ANSWER(endpoint, schema, params)));

describe("the landing's seat lines", () => {
  /* A Trainer-only seat, the narrowest there is: whatever an Ansprechperson reads, it reads too. */
  it("names each of the three seats, one pending, and an emptied slot as unfilled rather than leaving it out", async () => {
    setSubject(person({ sitze: [sitz({ rolle: "trainer" })] }));
    answeringSitze();
    try {
      const { text } = await rendered(TEAM_A, "2526");

      assert.ok(text.includes("Pia Klein · Ansprechperson · bestätigt"), text);
      assert.ok(text.includes("Tom Becker · Trainerin oder Trainer · noch nicht bestätigt"), text);
      assert.ok(text.includes("Stellvertretung: nicht besetzt"), text);
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });

  /* The read's answer carries an address and a number here, as a backend leak would: the page's schema is
     what keeps either off the landing and out of every prop the page hands its view. */
  it("carries no way to reach a seat holder, in the markup or in what the page hands its view", async () => {
    setSubject(person({ sitze: [sitz()] }));
    answeringSitze();
    try {
      const { markup } = await rendered(TEAM_A, "2526");
      const body = await pageBody(TeamStartPage, {
        params: Promise.resolve({ team_id: TEAM_A, saison_id: "2526" }),
        searchParams: Promise.resolve({}),
      });

      assert.ok(!markup.includes("sitz.invalid") && !markup.includes("0151"), "the landing renders a seat holder's address or number");
      assert.deepEqual(
        keysOf(body.props).filter((key) => CONTACT_KEY.test(key)),
        [],
        "the landing hands its view a way to reach a seat holder",
      );
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });

  /* The page's own check found the seat and the backend's, a moment later, did not. */
  it("renders the forbidden panel where the seat went between the check and the read", async () => {
    setSubject(person({ sitze: [sitz()] }));
    answerReadsWith((endpoint, schema, params) => {
      if (endpoint === SITZE_ENDPOINT) throw seatLost(endpoint);
      return EMPTIEST_ANSWER(endpoint, schema, params);
    });
    try {
      const { markup, text } = await rendered(TEAM_A, "2526");

      assert.ok(markup.includes(FORBIDDEN_BADGE) && text.includes("Hier bist Du nicht eingetragen."), text);
      assert.ok(!text.includes("Kontaktpersonen"), "the seat lines render beside the forbidden panel");
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });
});
