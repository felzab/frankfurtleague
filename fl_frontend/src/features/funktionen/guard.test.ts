import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { KONTAKT_EMAIL } from "@/core/brand.ts";
import { APIBadStatusError } from "@/core/errors.ts";
import { person, sitz, SITZ } from "@/core/subjectFixtures.ts";
import { filesUnder } from "@/core/treeWalk.ts";
import { doubleActionRequest, doubleEveryAction, loggedLines } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import {
  answerReadsWith,
  callPage,
  clearSteps,
  EMPTIEST_ANSWER,
  readsOf,
  redirectTarget,
  renderPage,
  steps,
} from "@/shared/testing/pageHarness.ts";
import { textOf } from "@/shared/testing/renderTest.ts";
import { schiedsrichterSelbst } from "@/shared/testing/selbstFixtures.ts";

import type { SubjectSession } from "@/core/subject.ts";
import type { ReactNode } from "react";

const { setSession, setSubject, subjectReads } = doubleActionRequest();
// The sign-in store as a person's session answers it: no administrator's verdict, and the person's
// landing. A case naming an administrator says so itself.
beforeEach(() => setSession(null, "/bereich"));

// The shells hand a sign-out action to the bar, whose real module reaches `next/server` past the harness.
doubleEveryAction();

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step and the doubles as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: PersoenlichLayout } = await import("@/app/bereich/(persoenlich)/layout.tsx");
const { FunktionenGuard } = await import("@/features/funktionen/components/providers/FunktionenGuard.tsx");
const { default: PersoenlichStartPage } = await import("@/app/bereich/(persoenlich)/page.tsx");
const { default: PersoenlichSchiedsrichterPage } = await import("@/app/bereich/(persoenlich)/schiedsrichter/page.tsx");
const { default: PersoenlichSpielerPage } = await import("@/app/bereich/(persoenlich)/spieler/page.tsx");
const { default: TeamLayout } = await import("@/app/bereich/team/[team_id]/[saison_id]/layout.tsx");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");
/** Every redirect the build loads, which Next answers before any route is matched. */
const { default: nextConfig } = await import("../../../next.config.ts");

const APP_DIR = path.resolve(import.meta.dirname, "..", "..", "app");

/** Every layout under the person area, the area's own among them, which is the floor. */
const PERSON_LAYOUTS = filesUnder(path.join(APP_DIR, "bereich", "(persoenlich)"), (name) => name === "layout.tsx", 1);

const TEAM_A = SITZ.team_id;
const TEAM_B = "6890a1b2c3d4e5f607250012";

const NO_PROPS = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

/** The fields of every refusal line logged since the case began. */
const refusalLines = (): unknown[] => loggedLines.filter(({ message }) => message === "funktion.verweigert").map(({ meta }) => meta);

/** Where a page or a chain of layouts sent the reader, `[]` where it rendered. */
async function redirectsOf(Page: () => unknown): Promise<string[]> {
  const { thrown } = await callPage(Page, NO_PROPS);
  return thrown.flatMap((error) => redirectTarget(error) ?? []);
}

/** The landing as the person area mounts it: under its layout, whose guard runs first. */
const landingUnderItsLayout = () => h(PersoenlichLayout, { children: h(PersoenlichStartPage) });

/** The `href` of every link the landing's switch offers. */
async function switchHrefs(): Promise<string[]> {
  const { markup, reads } = await renderedAlone(PersoenlichStartPage);
  assert.deepEqual(reads, [], "the landing reads past the session its switch is drawn from");

  return [...markup.matchAll(/<a [^>]*href="([^"]*)"/g)].map(([, href]) => href!);
}

/** A person page as its render leaves it, with every backend read the render made on the way. */
async function renderedAlone(Page: () => ReactNode | Promise<ReactNode>): Promise<{ markup: string; reads: string[] }> {
  clearSteps();
  const markup = await renderPage(underNext(h(Page)));

  return { markup: markup, reads: readsOf(steps).map(({ endpoint }) => endpoint) };
}

describe("the guard over the person area", () => {
  /* The layout's own turn-away, over a child that redirects nothing: under a page, the page's own
     redirect would pass this case with the layout's gone. */
  it("sends a request with no person's session to sign in", async () => {
    setSubject(null);

    assert.deepEqual(await redirectsOf(() => h(PersoenlichLayout, { children: h("p", null, "Seite") })), ["/signin"]);
  });

  /* The guard alone, which both lanes' layouts mount above their chrome. */
  it("turns a missing session away before anything under it renders", async () => {
    setSubject(null);

    assert.deepEqual(await redirectsOf(() => h(FunktionenGuard, { children: h("p", null, "Seite") })), ["/signin"]);
  });

  /* A layout above does not rerun on a soft navigation, so a nested one entered on a lapsed session is
     the first code to run: reading before its own session check, it serves that read to nobody. */
  it("reads nothing from any person-area layout for a request with no person's session", async () => {
    setSubject(null);

    for (const file of PERSON_LAYOUTS) {
      const { default: Layout } = (await import(pathToFileURL(file).href)) as { default: (props: { children: ReactNode }) => ReactNode };
      clearSteps();
      await callPage(() => h(Layout, { children: null }), NO_PROPS);

      assert.deepEqual(readsOf(steps), [], `${path.relative(APP_DIR, file)} reads before it checks the session`);
    }
  });

  /* The control for the cases above: a live session passes the layout and reaches the page under it,
     whose own answer is what comes back. */
  it("lets a person's session through to the page", async () => {
    setSubject(person({ sitze: [sitz()] }));

    assert.deepEqual(await redirectsOf(landingUnderItsLayout), [`/bereich/team/${TEAM_A}/2526`]);
  });
});

describe("where the landing takes a person", () => {
  /* The sign-in admitted this person on a record the account page serves, a past season's seat or a
     retired row among them, so the landing's one place is that page. */
  it("offers a person holding no Funktion the account page, as its one card", async () => {
    setSubject(person({ sitze: [sitz({ saison_status: "past" })] }));
    const { markup, reads } = await renderedAlone(PersoenlichStartPage);

    assert.deepEqual(reads, [], "the landing reads past the session it is drawn from");
    assert.deepEqual(await redirectsOf(PersoenlichStartPage), [], "the landing sent a person holding no Funktion away");
    assert.deepEqual(await switchHrefs(), ["/bereich/konto"]);
    assert.ok(textOf(markup, " ").replace(/\s+/g, " ").includes("Konto Was Du bei uns bestätigt hast, und Deine Anmeldung"), markup);
    assert.ok(!markup.includes("Noch nicht bestätigt"), "a person with nothing pending is told a link is waiting");
  });

  /* Records matched and none is confirmed, so what is missing is the person's own link: the notice
     says so, above the way to the account page, which holds the sign-in's own controls. */
  it("stands the pending notice above the account page's card where a record waits on the person's link", async () => {
    setSubject(person({ unbestaetigt: true }));
    const { markup, reads } = await renderedAlone(PersoenlichStartPage);

    assert.deepEqual(reads, [], "the pending page reads past the session it is drawn from");
    assert.ok(markup.includes("Noch nicht bestätigt"), "the pending page is not what renders");
    assert.ok(markup.includes("kontakt@frankfurtleague.de"), "the pending page names nobody to write to");
    assert.deepEqual(await switchHrefs(), ["/bereich/konto"]);
    assert.ok(markup.indexOf("Noch nicht bestätigt") < markup.indexOf('href="/bereich/konto"'), "the pending notice stands below the card");
    // The approved wording, whole: it names neither the record nor its team, which a mailbox typed by mistake would hand a stranger.
    assert.ok(
      textOf(markup, " ")
        .replace(/\s+/g, " ")
        .includes(
          `Du bist angemeldet, aber Deine Eintragung ist noch nicht bestätigt. Bestätige sie über den Link aus unserer E-Mail. Hast Du keinen bekommen, schreib uns an ${KONTAKT_EMAIL}.`,
        ),
      "the pending page's hint is not the approved sentence",
    );
  });

  /* A team's own landing is „Übersicht“ too, so one team alone is where the person goes. */
  it("sends a person holding one team alone straight there", async () => {
    setSubject(person({ sitze: [sitz()] }));

    assert.deepEqual(await redirectsOf(PersoenlichStartPage), [`/bereich/team/${TEAM_A}/2526`]);
  });

  /* Every person lands on a page named „Übersicht“: a lone player, referee or administrator meets this
     one, holding the one card, rather than their own page. */
  it("keeps a lone player, referee or administrator on the landing, with the one card", async () => {
    const cases: [SubjectSession, string][] = [
      [person({ spieler: [{ spieler_id: TEAM_A }] }), "/bereich/spieler"],
      [person({ schiedsrichter: [{ schiedsrichter_id: TEAM_A }] }), "/bereich/schiedsrichter"],
      [person({}, true), "/bereich/admin"],
    ];

    for (const [subject, card] of cases) {
      if (subject.admin) setSession({ user: { email: subject.email } }, "/bereich");
      setSubject(subject);
      assert.deepEqual(await redirectsOf(PersoenlichStartPage), [], `the landing sends a lone holder on to ${card}`);
      assert.deepEqual(await switchHrefs(), [card]);
    }
  });

  /* The grant is what makes an address an administrator's, so one whose verdict lapsed, past its
     window or short of the passkey, owes the admin subtree's step rather than a person's landing. */
  it("sends an address holding a grant whose administrator verdict lapsed to the admin subtree", async () => {
    setSubject(person({ spieler: [{ spieler_id: TEAM_A }], verwaltung: "administration", berechtigt_seit: "2026-01-01T00:00:00Z" }));
    assert.deepEqual(await redirectsOf(PersoenlichStartPage), ["/bereich/admin"]);

    // The control: the same records on an address holding no grant are a person's.
    setSubject(person({ spieler: [{ spieler_id: TEAM_A }] }));
    assert.deepEqual(await redirectsOf(PersoenlichStartPage), []);
  });

  /* An administrator whose verdict stands signs in to `/bereich`, so the landing offers the other places
     they hold rather than sending them on to the admin subtree. */
  it("offers an address holding a grant whose administrator verdict stands its own landing", async () => {
    setSession({ user: { email: "vorstand@example.org" } }, "/bereich");
    setSubject({
      ...person({ spieler: [{ spieler_id: TEAM_A }], verwaltung: "administration", berechtigt_seit: "2026-01-01T00:00:00Z" }, true),
      email: "vorstand@example.org",
    });

    assert.deepEqual(await redirectsOf(PersoenlichStartPage), [], "a standing administrator is sent away from the landing");
    assert.deepEqual(await switchHrefs(), ["/bereich/spieler", "/bereich/admin"]);
  });

  /* One address however many Funktionen lead there: a Trainer who is also the Ansprechperson, and two
     pupils sharing a mailbox, would otherwise be offered one page twice. */
  it("counts Funktionen leading to one address as one", async () => {
    setSubject(person({ sitze: [sitz({ rolle: "trainer" }), sitz({ rolle: "ansprechperson" })] }));
    assert.deepEqual(await redirectsOf(PersoenlichStartPage), [`/bereich/team/${TEAM_A}/2526`]);

    setSubject(person({ spieler: [{ spieler_id: TEAM_A }, { spieler_id: TEAM_B }] }));
    assert.deepEqual(await switchHrefs(), ["/bereich/spieler"]);
  });

  it("offers a link per team for seats on two teams", async () => {
    setSubject(person({ sitze: [sitz(), sitz({ team_id: TEAM_B, team_name: "Lessing-Gymnasium" })] }));

    assert.deepEqual(await redirectsOf(PersoenlichStartPage), [], "the switch redirected rather than offering a choice");
    assert.deepEqual(await switchHrefs(), [`/bereich/team/${TEAM_A}/2526`, `/bereich/team/${TEAM_B}/2526`]);
  });

  /* A list line takes a seat's short label, and one address held twice names both roles in the seats'
     declared order, whichever order the lookup answered them in. */
  it("names each entry's team, season and every role held there", async () => {
    setSubject(
      person({
        sitze: [sitz({ rolle: "trainer" }), sitz({ rolle: "ansprechperson" }), sitz({ team_id: TEAM_B, team_name: "Lessing-Gymnasium" })],
      }),
    );
    const { markup, reads } = await renderedAlone(PersoenlichStartPage);
    const text = textOf(markup, " ").replace(/\s+/g, " ");

    assert.deepEqual(reads, [], "the landing reads past the session its list is drawn from");
    assert.ok(text.includes("Goethe-Gymnasium Saison 2526 · Ansprechperson und Trainer"), text);
    assert.ok(text.includes("Lessing-Gymnasium Saison 2526 · Ansprechperson"), text);
  });

  /* One team across two seasons is two panels, each scoped to its season by the address. */
  it("offers a link per season for one team's seats in two seasons", async () => {
    setSubject(person({ sitze: [sitz(), sitz({ saison_id: "2627", saison_status: "future" })] }));

    assert.deepEqual(await switchHrefs(), [`/bereich/team/${TEAM_A}/2526`, `/bereich/team/${TEAM_A}/2627`]);
  });
});

describe("the way back from the account page", () => {
  /* Every shell links to the account page, which the person shell heads, and the switcher shows only
     from two places: holding one team or the administration alone, „Übersicht“ is the way back. */
  it("offers „Übersicht“ there whatever the person holds", async () => {
    const holders: [string, SubjectSession][] = [
      ["the administration alone", person({}, true)],
      ["one team", person({ sitze: [sitz()] })],
      ["one player row", person({ spieler: [{ spieler_id: TEAM_A }] })],
      ["nothing", person()],
    ];

    for (const [name, subject] of holders) {
      setSubject(subject);
      clearSteps();
      const markup = await renderPage(underNext(h(PersoenlichLayout, { children: null }), { pathname: "/bereich/konto" }));
      const links = [...markup.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, inner]) => ({
        href: href!,
        text: textOf(inner!, " ").replace(/\s+/g, " ").trim(),
      }));

      assert.deepEqual(readsOf(steps), [], `the account page's shell reads past the session for ${name}`);
      assert.ok(
        links.some((link) => link.href === "/bereich" && link.text.includes("Übersicht")),
        `a person holding ${name} has no way back from the account page`,
      );
    }
  });
});

/** One referee row as the own-data read serves it; the read's emptiest answer would hold none to show. */
const SCHIEDSRICHTER_SELBST = { ...schiedsrichterSelbst(), schiedsrichter_id: TEAM_A };

describe("the referee's page", () => {
  /* The person tier's own read, and no other: the page shows the referee their own data. */
  it("reads the referee's own records and shows their data", async () => {
    setSubject(person({ schiedsrichter: [{ schiedsrichter_id: TEAM_A }] }));
    answerReadsWith((endpoint, schema, params) =>
      endpoint === "/schiedsrichter/selbst"
        ? { acknowledged: 1, schiedsrichter: [SCHIEDSRICHTER_SELBST] }
        : EMPTIEST_ANSWER(endpoint, schema, params),
    );
    const { markup, reads } = await renderedAlone(PersoenlichSchiedsrichterPage);

    assert.deepEqual(reads, ["/schiedsrichter/selbst"]);
    assert.ok(textOf(markup, " ").includes("Mara Okafor"), "the referee's own data is not what renders");
    answerReadsWith(EMPTIEST_ANSWER);
  });

  /* The row went between the page's check and the backend's: the page's own turn-away, reached late. */
  it("sends a referee the backend finds no confirmed row for to the landing", async () => {
    setSubject(person({ schiedsrichter: [{ schiedsrichter_id: TEAM_A }] }));
    answerReadsWith(() => {
      throw refusedOn("GET /schiedsrichter/selbst", "REQ-FUNKTION-001");
    });

    assert.deepEqual(await redirectsOf(PersoenlichSchiedsrichterPage), ["/bereich"]);
    answerReadsWith(EMPTIEST_ANSWER);
  });

  /* The page speaks to a referee, so a person holding none is sent where their own Funktionen are. */
  it("sends a person holding no referee row to the landing, logging why", async () => {
    setSubject(person({ spieler: [{ spieler_id: TEAM_A }] }));

    assert.deepEqual(await redirectsOf(PersoenlichSchiedsrichterPage), ["/bereich"]);
    assert.deepEqual(refusalLines(), [{ operation: "/bereich/schiedsrichter", grund: "keine_funktion" }]);
  });
});

describe("the player's page", () => {
  /* The person tier's own read, and no other: the page shows the pupil their own data. */
  it("reads the player's own record and shows their data", async () => {
    setSubject(person({ spieler: [{ spieler_id: TEAM_A }] }));
    answerReadsWith(EMPTIEST_ANSWER);
    const { markup, reads } = await renderedAlone(PersoenlichSpielerPage);

    assert.deepEqual(reads, ["/spieler/selbst"]);
    assert.ok(textOf(markup, " ").includes("Deine Angaben"), "the player's own data is not what renders");
  });

  /* The row went between the page's check and the backend's: the page's own turn-away, reached late. */
  it("sends a player the backend finds no confirmed row for to the landing", async () => {
    setSubject(person({ spieler: [{ spieler_id: TEAM_A }] }));
    answerReadsWith(() => {
      throw refusedOn("GET /spieler/selbst", "REQ-FUNKTION-001");
    });

    assert.deepEqual(await redirectsOf(PersoenlichSpielerPage), ["/bereich"]);
    answerReadsWith(EMPTIEST_ANSWER);
  });

  /* The page speaks to a player, so a person holding no squad row is sent where their own Funktionen are. */
  it("sends a person holding no player row to the landing, logging why", async () => {
    setSubject(person({ schiedsrichter: [{ schiedsrichter_id: TEAM_A }] }));

    assert.deepEqual(await redirectsOf(PersoenlichSpielerPage), ["/bereich"]);
    assert.deepEqual(refusalLines(), [{ operation: "/bereich/spieler", grund: "keine_funktion" }]);
  });

  /* A page the person may read logs nothing: the line is a turn-away's alone. */
  it("logs no refusal for a person the page speaks to", async () => {
    setSubject(person({ spieler: [{ spieler_id: TEAM_A }] }));
    answerReadsWith(EMPTIEST_ANSWER);
    await renderedAlone(PersoenlichSpielerPage);

    assert.deepEqual(refusalLines(), []);
  });
});

describe("an own-record page's failed read", () => {
  /* A lost row alone answers the landing: a page reading every other failure as one sends a holder
     whose backend fell over away from the area's boundary, telling them nothing failed. */
  it("throws to the area's boundary from both pages, never answering it as a lost row", async () => {
    setSubject(person({ spieler: [{ spieler_id: TEAM_A }], schiedsrichter: [{ schiedsrichter_id: TEAM_A }] }));

    for (const [name, Page] of [
      ["the player's page", PersoenlichSpielerPage],
      ["the referee's page", PersoenlichSchiedsrichterPage],
    ] as const) {
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
        const { thrown } = await callPage(Page, NO_PROPS);

        assert.deepEqual(thrown, [failure], `${name} answers a failed read as something other than a failure`);
      } finally {
        answerReadsWith(EMPTIEST_ANSWER);
      }
    }
  });
});

/* The person write spine logs every turn-away of its own (`fl_frontend/src/shared/utils/personMutation.ts`);
   a page's is the same event in the same shape, so one query over the logs finds both lanes. */
describe("a team page's turn-away", () => {
  const teamAt = (teamId: string) =>
    h(TeamLayout, { params: Promise.resolve({ team_id: teamId, saison_id: "2526" }), children: h("p", null, "Seite") });

  it("logs the forbidden panel once, by the route's pattern and never the address", async () => {
    setSubject(person({ sitze: [sitz()] }));
    const markup = await renderPage(underNext(teamAt(TEAM_B), { pathname: `/bereich/team/${TEAM_B}/2526` }));

    assert.ok(!markup.includes("Seite"), "the page renders behind the forbidden panel");
    assert.deepEqual(refusalLines(), [{ operation: "/bereich/team/[team_id]/[saison_id]", grund: "kein_sitz" }]);
    assert.ok(!JSON.stringify(loggedLines).includes(TEAM_B), "the line names the address's team");
  });

  it("logs nothing at an address the person holds a seat on", async () => {
    setSubject(person({ sitze: [sitz()] }));
    await renderPage(underNext(teamAt(TEAM_A), { pathname: `/bereich/team/${TEAM_A}/2526` }));

    assert.deepEqual(refusalLines(), []);
  });
});

describe("the bare /bereich/admin", () => {
  /* The person area's catch-all matches every `/bereich/<word>` no sibling route takes, so a bare
     `/bereich/admin` with no page of its own would render the person layout to an administrator. */
  it("is answered inside the admin area, never by the person catch-all", async () => {
    const redirects = await nextConfig.redirects?.();
    const redirected = (redirects ?? []).some((rule) => rule.source === "/bereich/admin" && rule.destination.startsWith("/bereich/admin/"));

    assert.ok(
      existsSync(path.join(APP_DIR, "bereich", "admin", "page.tsx")) || redirected,
      "/bereich/admin has no page and no redirect into its subtree, so the person catch-all answers it",
    );
  });
});

/** A page answered with the team area's own parameters, which every other page ignores. */
const PAGE_PARAMS = { params: Promise.resolve({ team_id: TEAM_A, saison_id: "2526" }), searchParams: Promise.resolve({}) };

/** A segment matching what no sibling route does, whose page answers not-found for everyone. */
const CATCH_ALL = /^\[\.\.\..+\]$/;

/** Every person and team page, read off the tree so a page added tomorrow answers to the case below. */
const PERSON_PAGES = [
  ...filesUnder(path.join(APP_DIR, "bereich", "(persoenlich)"), (name) => name === "page.tsx", 3),
  ...filesUnder(path.join(APP_DIR, "bereich", "team"), (name) => name === "page.tsx", 1),
].filter((file) => !CATCH_ALL.test(path.basename(path.dirname(file))));

describe("every person page's subject", () => {
  /* A layout does not rerun on a soft navigation, so a lapsed session meets its redirect in the page.
     Called alone: the harness walks a page only where its layout returns it, which Next does not. */
  it("sends a request with no person's session to sign in from the page itself", async () => {
    setSubject(null);

    for (const file of PERSON_PAGES) {
      const { default: Page } = (await import(pathToFileURL(file).href)) as { default: (props: typeof PAGE_PARAMS) => unknown };
      const { thrown } = await callPage(Page, PAGE_PARAMS);

      assert.deepEqual(
        thrown.flatMap((error) => redirectTarget(error) ?? []),
        ["/signin"],
        `${path.relative(APP_DIR, file)} answers a lapsed session with no redirect to sign in`,
      );
    }
  });
});

type Layout = (props: { children: ReactNode }) => ReactNode | Promise<ReactNode>;

/** Every layout from the app root down to `dir`, outermost first: the chain Next wraps a page in there. */
async function layoutsDownTo(dir: string): Promise<Layout[]> {
  const chain: string[] = [];
  for (let at = dir; ; at = path.dirname(at)) {
    if (existsSync(path.join(at, "layout.tsx"))) chain.unshift(path.join(at, "layout.tsx"));
    if (at === APP_DIR) break;
  }

  return Promise.all(chain.map(async (file) => ((await import(pathToFileURL(file).href)) as { default: Layout }).default));
}

/** Around the page, recording that the walk got past every guard to it. */
let reached = false;
const Probe = ({ children }: { children: ReactNode }) => {
  reached = true;
  return children;
};

/** How often the subject is read rendering `dir`'s own page under every layout above it. */
async function readsUnder(dir: string): Promise<number> {
  const layouts = await layoutsDownTo(dir);
  const { default: Page } = (await import(pathToFileURL(path.join(dir, "page.tsx")).href)) as {
    default: (props: typeof PAGE_PARAMS) => ReactNode | Promise<ReactNode>;
  };
  const Chain = () => layouts.reduceRight<ReactNode>((inner, Layout) => h(Layout, { children: inner }), h(Probe, null, h(Page, PAGE_PARAMS)));
  reached = false;

  await callPage(Chain, NO_PROPS);
  assert.ok(reached, `the walk never reached the page under ${path.relative(APP_DIR, dir)}, so it proves nothing about reads`);

  return subjectReads();
}

describe("an admin render's subject reads", () => {
  /* The guard sits in the person's layouts only, so an administrator's request runs `getAdminSession`
     alone. A real admin page under every layout above it, which is where a guard added too high lands. */
  it("runs no person guard", async () => {
    setSession({ user: { email: "pia@example.org" } }, "/bereich");
    setSubject(person({ spieler: [{ spieler_id: TEAM_A }] }, true));

    assert.equal(await readsUnder(path.join(APP_DIR, "bereich", "admin", "sperrliste")), 0);
  });

  /* The control: the same walk under the person area reads the subject, so the count above is a
     counter that counts. */
  it("is made under the person area", async () => {
    setSubject(person({ spieler: [{ spieler_id: TEAM_A }] }));

    assert.notEqual(await readsUnder(path.join(APP_DIR, "bereich", "(persoenlich)", "spieler")), 0);
  });
});
