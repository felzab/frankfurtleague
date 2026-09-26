import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { filesUnder } from "@/core/treeWalk.ts";
import { doubleActionRequest, doubleEveryAction, exportingModule } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { callPage, redirectTarget, renderPage } from "@/shared/testing/pageHarness.ts";
import { textOf } from "@/shared/testing/renderTest.ts";

import type { FLSubjektSitz } from "@/core/schemas.ts";
import type { SubjectSession } from "@/core/subject.ts";
import type * as NextError from "next/error";
import type { ReactNode } from "react";

const { setSession, setSubject, subjectReads } = doubleActionRequest();
// The sign-in store as a person's session answers it: no administrator's verdict, and the person's
// landing. A case naming an administrator says so itself.
beforeEach(() => setSession(null, "/bereich"));

/** The one address the allowlist holds here, which the environment would otherwise name. */
const ALLOWLISTED = "vorstand@example.org";
const ALLOWLIST_DOUBLE = exportingModule({ isUserAdmin: (email?: string | null) => email === ALLOWLISTED });
// The shells hand a sign-out action to the bar, whose real module reaches `next/server` past the harness.
doubleEveryAction();

/* `next/error` is CommonJS whose exports Node's static reader cannot see, so an area boundary's ESM
   import of `catchError` fails at link. The shim hands on the real function rather than a stand-in. */
const NEXT_ERROR_INTEROP = exportingModule({ catchError: (createRequire(import.meta.filename)("next/error") as typeof NextError).catchError });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/error") return { url: `data:text/javascript,${encodeURIComponent(NEXT_ERROR_INTEROP)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/allowlist.ts")) return { format: "module", source: ALLOWLIST_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step and the doubles as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: PersoenlichLayout } = await import("@/app/bereich/(persoenlich)/layout.tsx");
const { FunktionenGuard } = await import("@/features/funktionen/components/providers/FunktionenGuard.tsx");
const { default: PersoenlichStartPage } = await import("@/app/bereich/(persoenlich)/page.tsx");
const { default: PersoenlichSchiedsrichterPage } = await import("@/app/bereich/(persoenlich)/schiedsrichter/page.tsx");
const { default: PersoenlichSpielerPage } = await import("@/app/bereich/(persoenlich)/spieler/page.tsx");
/** Every redirect the build loads, which Next answers before any route is matched. */
const { default: nextConfig } = await import("../../../next.config.ts");

const APP_DIR = path.resolve(import.meta.dirname, "..", "..", "app");

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
const person = (records: Partial<SubjectSession["subjekt"]> = {}, admin = false): SubjectSession => ({
  email: "pia@example.org",
  admin: admin,
  subjekt: { sitze: [], spieler: [], schiedsrichter: [], unbestaetigt: false, gesperrt: false, ...records },
});

const NO_PROPS = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

/** Where a page or a chain of layouts sent the reader, `[]` where it rendered. */
async function redirectsOf(Page: () => unknown): Promise<string[]> {
  const { thrown } = await callPage(Page, NO_PROPS);
  return thrown.flatMap((error) => redirectTarget(error) ?? []);
}

/** The landing as the person area mounts it: under its layout, whose guard runs first. */
const landingUnderItsLayout = () => h(PersoenlichLayout, { children: h(PersoenlichStartPage) });

/** The `href` of every link the landing's switch offers. */
async function switchHrefs(): Promise<string[]> {
  const markup = await renderPage(underNext(h(PersoenlichStartPage)));
  return [...markup.matchAll(/<a [^>]*href="([^"]*)"/g)].map(([, href]) => href!);
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

  /* The control for the cases above: a live session passes the layout and reaches the page under it,
     whose own answer is what comes back. */
  it("lets a person's session through to the page", async () => {
    setSubject(person({ spieler: [{ spieler_id: TEAM_A }] }));

    assert.deepEqual(await redirectsOf(landingUnderItsLayout), ["/bereich/spieler"]);
  });
});

describe("where the landing takes a person", () => {
  it("renders the empty landing for a person holding no Funktion", async () => {
    setSubject(person());
    const markup = await renderPage(underNext(h(PersoenlichStartPage)));

    assert.ok(markup.includes("nirgends eingetragen"), "the empty landing is not what renders");
    assert.ok(!markup.includes("Noch nicht bestätigt"), "a person with nothing pending is told a link is waiting");
  });

  /* The case that goes red the day the two states collapse into one: records matched and none is
     confirmed, so what is missing is the person's own link rather than a record. */
  it("renders the pending page, not the empty one, where a record waits on the person's link", async () => {
    setSubject(person({ unbestaetigt: true }));
    const markup = await renderPage(underNext(h(PersoenlichStartPage)));

    assert.ok(markup.includes("Noch nicht bestätigt"), "the pending page is not what renders");
    assert.ok(markup.includes("kontakt@frankfurtleague.de"), "the pending page names nobody to write to");
    assert.ok(!markup.includes("nirgends eingetragen"), "the pending person is told they are entered nowhere");
  });

  it("sends a person holding one Funktion straight to it", async () => {
    const cases: [SubjectSession, string][] = [
      [person({ sitze: [sitz()] }), `/bereich/team/${TEAM_A}/2526`],
      [person({ spieler: [{ spieler_id: TEAM_A }] }), "/bereich/spieler"],
      [person({ schiedsrichter: [{ schiedsrichter_id: TEAM_A }] }), "/bereich/schiedsrichter"],
      [person({}, true), "/bereich/admin"],
    ];

    for (const [subject, destination] of cases) {
      // An administrator's session is one the sign-in store sends to the admin subtree.
      if (subject.admin) setSession({ user: { email: subject.email } }, "/bereich/admin");
      setSubject(subject);
      assert.deepEqual(await redirectsOf(PersoenlichStartPage), [destination]);
    }
  });

  /* The allowlist is what makes an address an administrator's, so one whose verdict lapsed, past its
     window or short of the passkey, owes the admin subtree's step rather than a person's landing. */
  it("sends an allowlisted address whose administrator verdict lapsed to the admin subtree", async () => {
    setSubject({ ...person({ spieler: [{ spieler_id: TEAM_A }] }), email: ALLOWLISTED });
    assert.deepEqual(await redirectsOf(PersoenlichStartPage), ["/bereich/admin"]);

    // The control: the same records on an address the allowlist does not hold are a person's.
    setSubject(person({ spieler: [{ spieler_id: TEAM_A }] }));
    assert.deepEqual(await redirectsOf(PersoenlichStartPage), ["/bereich/spieler"]);
  });

  /* One address however many Funktionen lead there: a Trainer who is also the Ansprechperson, and two
     pupils sharing a mailbox, would otherwise be offered one page twice. */
  it("counts Funktionen leading to one address as one", async () => {
    setSubject(person({ sitze: [sitz({ rolle: "trainer" }), sitz({ rolle: "ansprechperson" })] }));
    assert.deepEqual(await redirectsOf(PersoenlichStartPage), [`/bereich/team/${TEAM_A}/2526`]);

    setSubject(person({ spieler: [{ spieler_id: TEAM_A }, { spieler_id: TEAM_B }] }));
    assert.deepEqual(await redirectsOf(PersoenlichStartPage), ["/bereich/spieler"]);
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
    const text = textOf(await renderPage(underNext(h(PersoenlichStartPage))), " ").replace(/\s+/g, " ");

    assert.ok(text.includes("Goethe-Gymnasium Saison 2526 · Ansprechperson und Trainer"), text);
    assert.ok(text.includes("Lessing-Gymnasium Saison 2526 · Ansprechperson"), text);
  });

  /* One team across two seasons is two panels, each scoped to its season by the address. */
  it("offers a link per season for one team's seats in two seasons", async () => {
    setSubject(person({ sitze: [sitz(), sitz({ saison_id: "2627", saison_status: "future" })] }));

    assert.deepEqual(await switchHrefs(), [`/bereich/team/${TEAM_A}/2526`, `/bereich/team/${TEAM_A}/2627`]);
  });
});

describe("the referee's page", () => {
  it("tells a referee that no match is assigned yet", async () => {
    setSubject(person({ schiedsrichter: [{ schiedsrichter_id: TEAM_A }] }));
    const markup = await renderPage(underNext(h(PersoenlichSchiedsrichterPage)));

    assert.ok(markup.includes("Dir ist noch kein Spiel zugeteilt."), "the referee's empty state is not what renders");
  });

  /* The page speaks to a referee, so a person holding none is sent where their own Funktionen are. */
  it("sends a person holding no referee row to the landing", async () => {
    setSubject(person({ spieler: [{ spieler_id: TEAM_A }] }));

    assert.deepEqual(await redirectsOf(PersoenlichSchiedsrichterPage), ["/bereich"]);
  });
});

describe("the player's page", () => {
  it("tells a player they are entered", async () => {
    setSubject(person({ spieler: [{ spieler_id: TEAM_A }] }));
    const markup = await renderPage(underNext(h(PersoenlichSpielerPage)));

    assert.ok(markup.includes("Du bist als Spieler eingetragen."), "the player's page is not what renders");
  });

  /* The page speaks to a player, so a person holding no squad row is sent where their own Funktionen are. */
  it("sends a person holding no player row to the landing", async () => {
    setSubject(person({ schiedsrichter: [{ schiedsrichter_id: TEAM_A }] }));

    assert.deepEqual(await redirectsOf(PersoenlichSpielerPage), ["/bereich"]);
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
    setSession({ user: { email: "pia@example.org" } }, "/bereich/admin");
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
