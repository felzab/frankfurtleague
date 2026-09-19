import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, mock } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { INSTAGRAM_HANDLE, INSTAGRAM_URL, KONTAKT_EMAIL } from "@/core/brand.ts";
import { BESTAETIGUNG_ABSAETZE, BESTAETIGUNG_KENNTNISNAHME, fuelleFassung } from "@/core/einwilligung.ts";
import { FIELD_LABEL } from "@/shared/components/ui/formFieldStyles.ts";
import { NAME_WRAP } from "@/shared/components/ui/nameWrap.ts";
import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { renderMarkup, renderTree, textOf } from "@/shared/testing/renderTest";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import { bestaetigungsLink } from "./bestaetigungLink.ts";
import { BEWERBUNG_MIN_ALTER } from "./constants.ts";

import type { FLBewerbungFensterResponse, FLKontaktRolle } from "./schemas.ts";
import type { LinkZustand } from "./types.ts";

/** The confirmation's write, answered by the case that sends one; unset, a request never returns. */
const fetchMock = mock.fn<() => Promise<Response>>(() => new Promise<never>(() => undefined));

// The browser's own `fetch` rather than the transport's module, so the panel's answer arrives through
// the one reader that decides which answers are this application's.
globalThis.fetch = (() => fetchMock()) as typeof fetch;

/** The toasts, replaced at the module boundary: the real module raises into HeroUI's queue. */
const { raised } = doubleToasts();

/*
 Every module below is reached AFTER both harnesses above have evaluated: the JSX compile step is
 registered, and the DOM installed, as each one does, and a static import resolves before either.
*/
const { ComboBox, Input, Label } = await import("@heroui/react");
const { BewerbungView } = await import("./components/views/BewerbungView.tsx");
const { FormTeamSection } = await import("./components/forms/BewerbungForm/FormTeamSection.tsx");
const { KontaktView } = await import("@/features/meta/components/views/KontaktView.tsx");
const { AboutView } = await import("@/features/meta/components/views/AboutView.tsx");
const { QA_QUESTIONS } = await import("@/features/meta/constants.ts");
const { ContentLoader } = await import("@/shared/components/ui/ContentLoader.tsx");
const { default: BewerbungLoading } = await import("@/app/(public)/bewerbung/[saison_id]/loading.tsx");
const { default: BewerbungPage } = await import("@/app/(public)/bewerbung/[saison_id]/page.tsx");
const { default: LandingPage } = await import("@/app/(public)/page.tsx");
const { default: KontaktPage } = await import("@/app/(public)/(meta)/kontakt/page.tsx");
const { BewerbungBandSkeleton } = await import("./components/ui/BewerbungBandSkeleton.tsx");
const { BewerbungInstagramBand } = await import("./components/ui/BewerbungInstagramBand.tsx");
const { band } = await import("./components/ui/band.ts");
const { ctaButton } = await import("@/shared/components/ui/formButtons.ts");
const { textLink } = await import("@/shared/components/ui/textLink.ts");
const { formPanel } = await import("@/shared/components/ui/formPanel.ts");
const { TRIKOT_FARBE_OPTIONS } = await import("@/features/teams/constants.ts");
const { fensterZustand, stampEinwilligungFassung } = await import("./utils.ts");
const { FLBewerbungEinwilligungAntwortPayloadSchema } = await import("./schemas.ts");
const { BestaetigungFormPanel } = await import("./components/views/BestaetigungFormPanel.tsx");

/** The words a reader presses to object, which the stamped version names in a paragraph of its own. */
const ABLEHNEN_LABEL = "Ich möchte nicht eingetragen sein";
const { BestaetigungHinweise, KlickBestaetigung, WhatsappHinweis, WiderspruchFolge } =
  await import("./components/views/BestaetigungHinweise.tsx");
const { FaktenBanner, GespeicherteAngaben } = await import("./components/views/BestaetigungPanels.tsx");
const { BestaetigungView } = await import("./components/views/BestaetigungView.tsx");

const FRONTEND_DIR = path.resolve(import.meta.dirname, "..", "..", "..");
const SRC_DIR = path.join(FRONTEND_DIR, "src");
const APP_DIR = path.join(SRC_DIR, "app");
const ROUTE_DIR = path.join(APP_DIR, "(public)", "bewerbung", "[saison_id]");

const LANDING = readFileSync(path.join(APP_DIR, "(public)", "page.tsx"), "utf8");
const PAGE = readFileSync(path.join(ROUTE_DIR, "page.tsx"), "utf8");
const VIEW = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "views", "BewerbungView.tsx"), "utf8");
const NEXT_CONFIG = readFileSync(path.join(FRONTEND_DIR, "next.config.ts"), "utf8");
const BAND = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "ui", "band.ts"), "utf8");
const BAND_COMPONENT = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "ui", "BewerbungOffenBand.tsx"), "utf8");
const SKELETON = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "ui", "BewerbungBandSkeleton.tsx"), "utf8");
const INVITATION_SOURCE = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "ui", "BewerbungInstagramBand.tsx"), "utf8");
const KONTAKT_PAGE = readFileSync(path.join(APP_DIR, "(public)", "(meta)", "kontakt", "page.tsx"), "utf8");
const POST_ROUTE = readFileSync(path.join(APP_DIR, "api", "bewerbung", "route.ts"), "utf8");
const CONFIRM_ROUTE = readFileSync(path.join(APP_DIR, "api", "bestaetigung", "route.ts"), "utf8");
/** The provider's delivery webhook, the one session-less route that takes neither spine. */
const ZUSTELLUNG_ROUTE = readFileSync(path.join(APP_DIR, "api", "mail", "zustellung", "route.ts"), "utf8");
const SWEEP = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "sweep.ts"), "utf8");
/** The confirmation page's fact banner, read where the recipe it reaches for leaves no mark on the markup. */
const PANELS = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "views", "BestaetigungPanels.tsx"), "utf8");
const ACTIONS = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "actions.ts"), "utf8");

/** The `saison` slot, cut out so an assertion reads it and nothing near it. */
const SAISON = /saison: "([^"]*)"/.exec(BAND)?.[1] ?? "";

/** Names no school the placeholders already carry, so a hit is the list rather than a hint text. */
const SCHOOLS = [
  { id: "68d0f2a4c1e2b3a4d5e6f708", name: "Lessing-Kolleg" },
  { id: "68d0f2a4c1e2b3a4d5e6f709", name: "Riedberg-Oberstufe" },
] as const;

const TODAY = "2026-04-01";
const FENSTER: FLBewerbungFensterResponse = {
  acknowledged: 1,
  saison_id: "2026",
  offen: true,
  von: "2026-03-01",
  bis: "2026-04-30",
  laeuft: true,
};

const BASE_PROPS = { saisonId: "2026", isUnlesbar: false, today: TODAY, schulen: SCHOOLS, isSchulenLesbar: true, vergebeneFarben: [] };

/** One prop set per window state, named by `fensterZustand` itself rather than by a label typed here. */
const WINDOW_STATES = [
  { ...BASE_PROPS, fenster: FENSTER },
  { ...BASE_PROPS, fenster: { ...FENSTER, laeuft: false, von: "2026-05-01", bis: "2026-05-31" } },
  { ...BASE_PROPS, fenster: { ...FENSTER, laeuft: false, offen: false } },
  { ...BASE_PROPS, fenster: { ...FENSTER, laeuft: false, von: "2026-01-01", bis: "2026-02-01" } },
  { ...BASE_PROPS, fenster: null },
  { ...BASE_PROPS, fenster: null, isUnlesbar: true },
].map((props) => ({
  zustand: props.isUnlesbar ? "unlesbar" : fensterZustand(props.fenster, props.today),
  html: renderMarkup(BewerbungView, props),
}));

const RUNNING_PAGE = WINDOW_STATES.find((eintrag) => eintrag.zustand === "laeuft")?.html ?? "";
const CLOSED_PAGE = WINDOW_STATES.find((eintrag) => eintrag.zustand === "geschlossen")?.html ?? "";

/** The strip on its own, so a case reads the invitation rather than the page it is sitting on. */
const INVITATION = renderMarkup(BewerbungInstagramBand, {});

/** The sentence a reader meets, spelled here so a re-polish of the rendered one fails rather than ships. */
const INVITATION_SENTENCE =
  "Ihr wollt eure Chancen auf eine Zusage verbessern? Ladet einen Beitrag auf Instagram hoch, am besten ein Video, in dem ihr erzählt, warum ihr in die Liga wollt, und markiert @frankfurt.league.";

/** The outermost element's class list, which is where a recipe lands — read inside its own tag alone. */
const rootClass = (html: string): string => /class="([^"]*)"/.exec(html.slice(0, html.indexOf(">")))?.[1] ?? "";

/** The level of the heading a fragment is rendered inside: the last one opened above it. */
function headingLevelOf(html: string, text: string): number | null {
  const at = html.indexOf(text);
  if (at === -1) return null;
  const lastOpened = [...html.slice(0, at).matchAll(/<h([1-6])\b/g)].at(-1);

  return lastOpened === undefined ? null : Number(lastOpened[1]);
}

/** Every link the header renders, as a reader meets it: where it goes, how it is dressed, what it says. */
function headerLinks(html: string): { href: string; classesOf: string; text: string; icons: string[] }[] {
  const nav = /<nav\b[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";

  return [...nav.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((hit) => ({
    href: /href="([^"]*)"/.exec(hit[1] ?? "")?.[1] ?? "",
    classesOf: /class="([^"]*)"/.exec(hit[1] ?? "")?.[1] ?? "",
    text: textOf(hit[2] ?? "").trim(),
    icons: [...(hit[2] ?? "").matchAll(/<path[^>]*\bd="([^"]*)"/g)].map((pathAt) => pathAt[1] ?? ""),
  }));
}

/**
 * Where a public path is answered — a page file, or a redirect in `next.config.ts`. `/dashboard` is
 * the second kind, so a check for a page file alone would call a working link broken.
 */
function isRouteAnswered(href: string): boolean {
  const segments = href.replace(/^\//, "").split("/");
  const candidates = [
    path.join(APP_DIR, "(public)", "(meta)", ...segments, "page.tsx"),
    path.join(APP_DIR, "(public)", ...segments, "page.tsx"),
    path.join(APP_DIR, ...segments, "page.tsx"),
  ];

  return candidates.some((candidate) => existsSync(candidate)) || NEXT_CONFIG.includes(`source: "${href}"`);
}

/** The confirmation form a contact's link opens, rendered so a press can arm the objection. */
function renderBestaetigung() {
  const user = userEvent.setup();
  const view = render(
    h(BestaetigungFormPanel, {
      token: "kein-echtes-token",
      vorname: "Mira",
      schule: "Lessing-Kolleg",
      saison: "2026",
      rolle: "Ansprechperson",
      onAbschluss: () => undefined,
    }),
  );

  return { user, ...view };
}

describe("the window state the application page renders", () => {
  /* First: every case below reads these renders, and a props table that had collapsed onto one state
     would leave each of them asserting over the same page six times. */
  it("renders each of the six states the page has an answer for", () => {
    assert.deepEqual(
      [...WINDOW_STATES.map((eintrag) => eintrag.zustand)].sort(),
      ["geschlossen", "keine-frist", "laeuft", "noch-nicht", "unlesbar", "vorbei"],
      "the fixtures no longer put the page into one state each",
    );
  });

  /* „Trag Dein Team hier ein“ above a panel saying the window is shut is the page contradicting
     itself, and the invitation and the form can drift onto different conditions. */
  it("invites an application on the one state that renders a form", () => {
    const invited = WINDOW_STATES.filter(({ html }) => html.includes("Trag Dein Team hier ein"));
    const withForm = WINDOW_STATES.filter(({ html }) => html.includes('name="team_id"'));

    assert.deepEqual(
      invited.map((eintrag) => eintrag.zustand),
      ["laeuft"],
      "the invitation renders in a state that shows no form",
    );
    assert.deepEqual(
      withForm.map((eintrag) => eintrag.zustand),
      ["laeuft"],
      "a state that cannot take an application renders the form anyway",
    );
  });

  /* The lead is the one site: the receipt panel and the three mails carry the fact from the press
     onwards, so a second wording above the button is one promise said twice. */
  it("says in the lead, and only there, what the press sets in motion", () => {
    assert.ok(
      RUNNING_PAGE.includes("Nach dem Abschicken bekommt jede Kontaktperson eine E-Mail"),
      "the running state never says what the press sets in motion",
    );
    assert.doesNotMatch(RUNNING_PAGE, /Mit dem Abschicken/, "the page repeats the press's consequence above the submit");
    // One noun for one link on both sites, the E-Mail fields' own hint included: „Link zur
    // Einwilligung“ beside „Link zur Bestätigung“ reads as two different links.
    assert.doesNotMatch(RUNNING_PAGE, /Link zur Einwilligung/, "the two sites name the link differently from the field hint");
  });

  /* A closed window renders the page rather than a 404, so every closed state owes the reader a
     sentence of its own — an empty body reads as a page that failed to load. */
  it("answers every closed state with a heading of its own", () => {
    const closedPages = WINDOW_STATES.filter(({ zustand }) => zustand !== "laeuft");
    const headings = closedPages.map(({ html }) => /<h2[^>]*>([^<]*)<\/h2>/.exec(html)?.[1] ?? "");

    for (const [index, headingText] of headings.entries()) {
      assert.notEqual(headingText, "", `${closedPages[index]?.zustand ?? ""} renders no answer at all`);
    }
    assert.equal(new Set(headings).size, headings.length, "two closed states give the reader the same answer");
  });
});

describe("how the application page invites a post about the application", () => {
  /* A school reading a closed page cannot apply, so a post tagging the league buys it nothing, and
     the invitation and the form can drift onto different conditions. */
  it("invites the post on the one state that takes an application", () => {
    const invited = WINDOW_STATES.filter(({ html }) => html.includes(INSTAGRAM_HANDLE));

    assert.deepEqual(
      invited.map((eintrag) => eintrag.zustand),
      ["laeuft"],
      "a state that can take no application invites a post about one",
    );
  });

  /* Pinned as one string because I dictated it: every other rule the page's copy keeps would produce
     a different sentence, so a pass tidying the page toward them is what this case refuses. */
  it("renders the sentence I dictated, whole", () => {
    assert.equal(textOf(INVITATION).replace(/\s+/g, " ").trim(), INVITATION_SENTENCE, "the invitation was reworded");
  });

  it("reads its box off the band recipe rather than retyping it", () => {
    assert.match(INVITATION_SOURCE, /band\(\)/, "the strip hand-writes a box the season band already has a recipe for");
    /* The ground token is the recipe's alone, so any hand copy of the box carries it whatever order
       the formatter sorts the copy into, where a prefix of the spelling would miss a re-sorted one. */
    assert.doesNotMatch(INVITATION_SOURCE, /className="[^"]*\bbg-surface\b/, "a second spelling of the band box is back");
    // Catches the OTHER half: a call that reaches the recipe and asks it for a different ground.
    assert.equal(rootClass(INVITATION), band().root(), "the strip renders a box other than the recipe's surface ground");
  });

  it("makes the handle the one tap target, and the strip itself none", () => {
    const links = [...INVITATION.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)];
    const attribute = links[0]?.[1] ?? "";

    assert.equal(links.length, 1, "the strip offers a number of links other than the handle alone");
    // A strip that is one large link takes a half-filled form off the screen on any stray press.
    assert.match(INVITATION.slice(0, INVITATION.indexOf(">")), /^<div\b/, "the whole strip is pressable");
    assert.equal(textOf(links[0]?.[2] ?? "").trim(), INSTAGRAM_HANDLE, "the link names something other than the handle");
    assert.ok(attribute.includes(`href="${INSTAGRAM_URL}"`), "the handle points somewhere other than the profile");
    assert.ok(attribute.includes(`class="${textLink()}"`), "the handle wears a treatment of its own");
    // The form is half filled in behind it, and this tab is where the applicant has to come back to.
    assert.match(attribute, /target="_blank"/, "the profile replaces the page the reader is filling in");
    assert.match(attribute, /rel="noopener noreferrer"/, "the opened tab keeps a handle on this one");
  });

  it("carries the footer's own Instagram mark, neutral and hidden from a reader", () => {
    const mark = [...INVITATION.matchAll(/<span ([^>]*)>/g)].map(([, raw = ""]) => raw).find((raw) => raw.includes("instagram_logo_black.svg"));
    const glyphFile = path.join(FRONTEND_DIR, "public", "icons", "footer", "instagram", "instagram_logo_black.svg");

    assert.notEqual(mark, undefined, "the strip masks no span with the footer's own Instagram file");
    // A mask over a file the app does not serve renders a box of empty colour, and nothing else fails.
    assert.ok(existsSync(glyphFile), "the file the mask names is no longer served from `public/`");
    assert.match(mark ?? "", /aria-hidden="true"/, "the mark is read out beside a sentence that already names Instagram");
    // A third party's logo in our own red, under a header already carrying four brand accents.
    assert.match(mark ?? "", /bg-foreground[\s"]/, "the mark is tinted, so the strip advertises rather than notes");
    assert.match(mark ?? "", /size-5[\s"]/, "the mark is sized for a social row rather than for the paragraph beside it");
  });

  /* Two grades are refused here, one on each side: bold runs on this site are labels, pills, buttons
     and one-line straplines, and `muted-meta` is the caption grade, a step under the lead paragraph
     above it. */
  it("sets the sentence at the page's own paragraph grade, neither bold nor the caption step", () => {
    assert.equal(/<p class="([^"]*)"/.exec(INVITATION)?.[1], "muted-hint", "the invitation is graded apart from the paragraphs around it");
  });

  /* The page's outline is the header's `<h1>` and one `<h2>` per panel, and this strip is neither a
     panel nor a section of one. */
  it("opens no heading of its own", () => {
    assert.doesNotMatch(INVITATION, /<h[1-6][\s>]/, "the strip spells a heading the page's outline does not account for");
  });

  it("stands once, between the page's opening block and the form element", () => {
    const headerEnd = RUNNING_PAGE.indexOf("</header>");
    const invitationAt = RUNNING_PAGE.indexOf(INSTAGRAM_HANDLE);
    const formAt = RUNNING_PAGE.indexOf("<form");

    assert.notEqual(headerEnd, -1, "the running page closes no header, so the bounds below read nothing");
    assert.notEqual(formAt, -1, "the running page renders no form, so the bounds below read nothing");
    assert.ok(invitationAt > headerEnd, "the invitation cuts into the opening block");
    // The `<form>` itself, not merely its first field: inside it the strip is part of what a submit reads.
    assert.ok(invitationAt < formAt, "the invitation stands inside the form the reader is filling in");
    // The receipt swaps itself in for the form alone, so a second strip the PAGE held would stand
    // beside the one under the receipt and the reader would meet the same invitation twice at once.
    assert.equal((RUNNING_PAGE.match(/instagram_logo_black/g) ?? []).length, 1, "the running page draws the invitation other than once");
  });
});

describe("the links the application page's header offers", () => {
  /* A header offering nothing is the failure the assertions below cannot see: they would all pass
     over an empty list. */
  it("renders all three of them, in order", () => {
    assert.deepEqual(
      headerLinks(RUNNING_PAGE).map((link) => link.href),
      ["/about", "/kontakt", "/dashboard"],
      "the header no longer offers About, Kontakt and the dashboard",
    );
  });

  /* Driven off the RENDERED hrefs, so a link this suite has never seen is checked too. Whether a
     path is answered is the router tree's answer and appears in no markup. */
  it("lands somewhere for every href it renders", () => {
    for (const { href } of headerLinks(RUNNING_PAGE)) {
      assert.ok(isRouteAnswered(href), `${href} has neither a page nor a redirect`);
    }
  });

  /* `?saison_id=` here would pin the link to the season being APPLIED for, which is a future one the
     dashboard withholds. Bare, the redirect resolves the running season instead. */
  it("leaves the dashboard link unparameterised, and says which season it opens", () => {
    const dashboard = headerLinks(RUNNING_PAGE).find((link) => link.href.startsWith("/dashboard"));

    assert.ok(dashboard, "the header no longer offers the dashboard at all");
    assert.equal(dashboard.href, "/dashboard", "the dashboard link carries a season the dashboard cannot show");
    /* Which is why the words may not be the nav's generic ones: the banner above states the season
       applied for, and this link opens a different one. A reader who learns that after the click
       learnt it too late. */
    assert.match(dashboard.text, /[Ll]aufende/, "the dashboard link no longer says which season it opens");
  });

  /* Peers, not a ranked set: same treatment, one icon each so they are tellable apart at a glance.
     A link that lost either half reads as a different kind of control from the two beside it. */
  it("gives every link a reason above it and an icon of its own inside it", () => {
    const nav = /<nav\b[^>]*>([\s\S]*?)<\/nav>/.exec(RUNNING_PAGE)?.[1] ?? "";
    const reasonsAbove = [...nav.matchAll(/<span[^>]*>([^<]+)<\/span><a /g)].map((hit) => (hit[1] ?? "").trim());
    const icons = headerLinks(RUNNING_PAGE).flatMap((link) => link.icons);

    assert.equal(reasonsAbove.length, 3, "a header link renders no reason directly above it");
    for (const reasonAbove of reasonsAbove) assert.notEqual(reasonAbove, "", "a header link's reason renders as nothing");
    assert.equal(icons.length, 3, "a header link renders no icon, or renders two");
    assert.equal(new Set(icons).size, 3, "two header links draw the same glyph, so the pair cannot be told apart");
  });

  /* The outline treatment is what makes them equal. A `primary` among them would rank one above the
     other two, which is the hierarchy these three deliberately do not have. */
  it("dresses all three in the outline recipe rather than promoting one", () => {
    const outline = ctaButton({ intent: "outline", size: "sm", hover: "css" }).split(" ");
    const primary = ctaButton({ intent: "primary", size: "sm", hover: "css" }).split(" ");
    // The classes the fill has and the outline has not, so this survives a retokenised recipe.
    const primaryOnly = primary.filter((classToken) => !outline.includes(classToken));

    assert.notEqual(primaryOnly.length, 0, "the two treatments render alike, so this case compares nothing");
    for (const link of headerLinks(RUNNING_PAGE)) {
      const classesOf = link.classesOf.split(" ");

      for (const classToken of outline) assert.ok(classesOf.includes(classToken), `${link.href} lost the outline recipe's ${classToken}`);
      for (const classToken of primaryOnly) assert.ok(!classesOf.includes(classToken), `${link.href} was promoted above the other two`);
    }
  });

  /* Read rather than rendered: a literal spelling the recipe's classes renders markup identical to
     the recipe's, so only the source tells a nav that READS `ctaButton` from a copy of its output. */
  it("reads that recipe off ctaButton rather than retyping its classes", () => {
    assert.match(VIEW, /ctaButton\(\{ intent: "outline", size: "sm", hover: "css" \}\)/, "the header hand-writes what the recipe spells");
    assert.doesNotMatch(VIEW, /transform-none items-center justify-center rounded-xl/, "a second spelling of the recipe's classes is back");
  });
});

describe("how the page spells the box a panel sits in", () => {
  /* The state panels have to say what the form's own sections say, and only the rendered box shows
     whether they do. */
  it("wears the form panel's own box", () => {
    const panel = /<div class="([^"]*)"><h2/.exec(CLOSED_PAGE)?.[1] ?? "";

    assert.notEqual(panel, "", "the closed state renders no panel this case can read");
    for (const classToken of formPanel().root().split(" ")) {
      assert.ok(panel.split(" ").includes(classToken), `the state panel's box is missing formPanel's ${classToken}`);
    }
  });

  /* Read rather than rendered: a literal spelling the recipe's own classes renders identical markup,
     so only the source separates a box that READS `formPanel` from a second copy of it. The copy
     drifts at the next change to either. */
  it("reads that box off formPanel rather than retyping it", () => {
    assert.match(VIEW, /formPanel\(\)\.root\(\)/, "the state panel hand-writes a box the form already has a recipe for");
    assert.doesNotMatch(VIEW, /"border-border bg-surface flex w-full flex-col/, "a second spelling of the panel box is back");
  });
});

describe("what the application page holds while it loads", () => {
  /* A navigation renders `loading.tsx`, and either state that does not fill the VIEWPORT leaves the
     site footer on screen for the length of the read. `fills` defaults to `region`. */
  it("fills the viewport on a navigation", () => {
    const region = rootClass(renderMarkup(ContentLoader, {}));
    const viewport = rootClass(renderMarkup(ContentLoader, { fills: "viewport" as const }));

    assert.notEqual(region, viewport, "the two fills render alike, so this case compares nothing");
    assert.equal(rootClass(renderMarkup(BewerbungLoading, {})), viewport, "the route's loading.tsx stops short of the footer");
  });

  /* The streamed half is the page's own boundary: everything inside it awaits, so a render of the
     page draws the fallback and nothing else, which is the state a reader meets first. */
  it("fills the viewport on a stream", () => {
    const region = rootClass(renderMarkup(ContentLoader, {}));
    const viewport = rootClass(renderMarkup(ContentLoader, { fills: "viewport" as const }));
    const streamed = renderMarkup(BewerbungPage, { params: Promise.resolve({ saison_id: "2026" }), searchParams: Promise.resolve({}) });

    assert.notEqual(region, viewport, "the two fills render alike, so this case compares nothing");
    assert.equal(rootClass(streamed), viewport, "the page's boundary stops short of the footer");
    /* Read beside the render: a `<div>` spelling the loader's own classes renders the same markup, so
       only the source says the boundary holds the component rather than a copy of its output. */
    assert.match(PAGE, /fallback=\{<ContentLoader fills="viewport" \/>\}/, "the page's boundary no longer holds a ContentLoader");
  });
});

/*
 Read rather than rendered: what is asserted is which classes a recipe wrote and that no call site
 asks the recipe for a second box — a rendered class list is one flat string that shows neither.
*/
describe("how the band writes the season it is inviting applications for", () => {
  /* The slot deliberately carries its colour in the recipe, so an assertion at a call site would be
     satisfied by a recipe that had dropped the brand. */
  it("tints the season with the brand itself", () => {
    assert.match(SAISON, /(^|\s)text-brand(\s|$)/, "the band no longer writes the season in the brand colour");
  });

  /* The other half of the pair above: a colour written beside the slot at the call site is the drift
     one recipe for every band exists to stop. Fill or text alike, both are a colour. */
  it("colours the season in the recipe and nowhere else", () => {
    assert.doesNotMatch(BAND_COMPONENT, /styles\.saison\(\)\} [^"]*(text|bg)-/, "the call site writes a second colour onto the season");
  });

  /* One box, because one ground is left to sit on. A second box is what cut a pale rectangle into a
     page that had a card recipe of its own, and no page now needs one. */
  it("offers one box and no second ground", () => {
    assert.doesNotMatch(BAND, /variants:/i, "the recipe offers a call site a box to choose between again");
    /* `\b` on both sides, or `text-foreground` in the `text` slot matches and the assertion can never
       pass: a compound ending in the word is not the word. */
    assert.doesNotMatch(BAND, /\bground\b/, "the recipe names a ground again");
    assert.match(BAND, /root: "[^"]*\bbg-surface\b/, "the band lost the card box every page seats it in");
  });

  /* The one box is nobody's to ask for, so the contact page asks for nothing. */
  it("seats the contact page's band on the one box, asking for nothing", () => {
    assert.match(KONTAKT_PAGE, /<BewerbungOffenBand \/>/, "the contact page hands the band a prop it no longer takes");
    assert.doesNotMatch(KONTAKT_PAGE, /\bground=/, "the contact band asks for a ground again");
  });
});

/*
 What a module imports reaches no markup. The stake is a client component importing the recipe out of
 a module that pulls `server-only`, which fails at `next build` and nowhere earlier.
*/
describe("what the band's recipe is allowed to reach", () => {
  it("stands in a module that imports no query", () => {
    const imports = [...BAND.matchAll(/^import[^;]*from "([^"]*)";$/gm)].map((hit) => hit[1]);

    assert.deepEqual(imports, ["tailwind-variants"], "the recipe's module reaches something besides its own dependency");
  });
});

/*
 What is read rather than rendered below is which component is handed to which as a prop, and which
 classes a recipe wrote: a prop binding reaches no markup, and a literal spelling those classes
 renders identical markup.
*/
describe("what the landing page's one band slot holds", () => {
  /* The contact band reaches the page ONLY as what stands in for the application band, so a running
     window replaces it rather than adding a second band under it. */
  it("renders the contact band only through the application band", () => {
    assert.match(LANDING, /ersatz=\{<KontaktBand \/>\}/, "the contact band is no longer the application band's stand-in");
    assert.equal((LANDING.match(/<KontaktBand \/>/g) ?? []).length, 1, "the contact band is rendered somewhere besides the slot");
  });

  /* Neither band's words may be the fallback: the read resolves after paint, so a sentence there is
     one the reader watches being swapped for a different one. A skeleton says „not yet“ instead. */
  it("falls back to a skeleton rather than to either band's words", () => {
    const landing = renderMarkup(LandingPage, {});

    assert.ok(landing.includes(renderMarkup(BewerbungBandSkeleton, {})), "the band slot falls back to something other than its skeleton");
    assert.doesNotMatch(landing, /Deine Schule|Du hast Fragen/, "the fallback shows words it may have to swap for different ones");
    /* Anchored on the slot rather than the page: the render finds the skeleton's markup ANYWHERE, so
       a skeleton moved out of the fallback and drawn as a standing sibling satisfies it. */
    assert.match(
      LANDING,
      /<Suspense fallback=\{<BewerbungBandSkeleton \/>\}>\s*<BewerbungOffenBand/,
      "the band's slot falls back to something else",
    );
  });

  /* The skeleton is built FROM the recipes it stands in for, so its height cannot drift from theirs.
     A skeleton that changes the layout on resolve is worse than no skeleton. */
  it("builds the skeleton from the band's own recipe rather than from copied classes", () => {
    // Anchored on the assignment, never on `band()` anywhere: the doc comment above names the recipe too.
    assert.match(SKELETON, /= band\(\);/, "the skeleton restates the band's box instead of reading it");
    assert.match(SKELETON, /ctaButton\(\{/, "the skeleton restates the control's height instead of reading it");
    // The placeholder's tone is the recipe's default, so no call site is in a position to pick one.
    assert.doesNotMatch(SKELETON, /skeletonBlock\(\{/, "the skeleton picks a placeholder tone instead of taking the one default");
  });

  /* The contact page keeps `null`: its band renders nothing for most of the year, and a skeleton
     resolving to nothing would open a gap the slot does not otherwise cost. */
  it("leaves the contact page's slot costing nothing while it waits", () => {
    assert.equal(renderMarkup(KontaktPage, {}), renderMarkup(KontaktView, {}), "the contact page's slot reserves space its band may not fill");
  });

  /* The two halves drift apart on their own: the page can stop passing the slot, or the view can
     stop rendering it, and either leaves the band silently gone with every gate green. */
  it("passes the band into the view rather than rendering it beside", () => {
    assert.match(KONTAKT_PAGE, /bewerbungSlot=\{/, "the contact page no longer hands the band to the view");
    assert.match(KONTAKT_PAGE, /<BewerbungOffenBand[^>]*\/>/, "the contact page stopped rendering the band");
  });
});

describe("where the contact page seats the application band", () => {
  /* Under the page's own opening block, above everything else: a band below the first section is one
     a reader meets after they have already read past the reason to press it. */
  it("renders the slot between the hero and the channels heading", () => {
    const html = renderMarkup(KontaktView, { bewerbungSlot: h("div", { "data-band": "" }, "BEWERBUNGSSLOT") });
    const slot = html.indexOf("BEWERBUNGSSLOT");
    const leadAt = html.indexOf("offenes Ohr");
    const channelsAt = html.indexOf("<h2");

    assert.notEqual(slot, -1, "the view renders no band slot at all");
    assert.notEqual(leadAt, -1, "the view renders no lead, so the bound below reads nothing");
    assert.notEqual(channelsAt, -1, "the view renders no section heading, so the bound below reads nothing");
    assert.match(
      html.slice(channelsAt, html.indexOf("</h2>", channelsAt)),
      /Kanäle/,
      "the first heading is not the channels heading, so the bound below reads the wrong section",
    );
    assert.ok(slot > leadAt, "the band sits above the hero");
    assert.ok(slot < channelsAt, "the band sits below the opening block instead of under the hero");
  });
});

describe("where the about page's questions sit in the heading outline", () => {
  /* `Accordion.Heading` sets no level: HeroUI hands it to react-aria's `Heading`, whose own default
     is the only thing deciding it, so nothing short of a render says which element a question is in. */
  it("renders every question one heading level under the section it is in", () => {
    const html = renderMarkup(AboutView, {});
    const sectionLevel = headingLevelOf(html, "Fragen und Antworten");

    assert.notEqual(sectionLevel, null, "the about page renders no section heading, so the comparison below reads nothing");
    assert.deepEqual(
      QA_QUESTIONS.map((frage) => headingLevelOf(html, frage.q)),
      QA_QUESTIONS.map(() => (sectionLevel === null ? null : sectionLevel + 1)),
      "a question does not sit one heading level under the section it is in",
    );
  });
});

describe("who the submission's receipt is addressed to", () => {
  /* Which collector the route CALLS, the collectors themselves being pinned in `notifications.test.ts`.
     Swapped for the decision fan-out, the receipt reaches three addresses nobody has confirmed yet,
     and every test in this suite goes on passing. */
  it("collects the Ansprechperson's mailbox alone, never the decision fan-out", () => {
    assert.match(POST_ROUTE, /collectBewerbungEingangEmpfaenger\(kontakte\)/, "the receipt uses another collector");
    assert.doesNotMatch(POST_ROUTE, /collectBewerbungEmpfaenger\(/, "the receipt fans out the way a committed decision does");
  });

  /* One link message per mailbox, and the seats the receipt already answers for left out of it:
     their link travels in the receipt, and a second message asks one reader twice for one press. */
  it("sends the link messages per mailbox, without the seats the receipt already carries", () => {
    assert.match(POST_ROUTE, /sendBewerbungLinkMail\(/, "the links are fanned out through the per-recipient sender");
    assert.match(
      POST_ROUTE,
      /empfangsSitze\(kontakte\.trainer_ist_zugleich\)/,
      "the withheld set is decided here rather than where it is pinned",
    );
    /* Both lists read that one set: a mirrored seat left on the link map gets a second message, and
       one left on the outstanding list sends the reader chasing themselves. */
    assert.equal(
      (POST_ROUTE.match(/!imEmpfang\.includes\(seat\.value\)/g) ?? []).length,
      2,
      "the link map and the outstanding list no longer read the same withheld set",
    );
    assert.match(POST_ROUTE, /link: bestaetigungsLink\(origin, seats\.ansprechperson\)/, "the receipt carries no link of its own");
  });

  /* A handler answers a request rather than rendering, so this is read: one person holding two seats
     is one press, and a receipt listing both rows sends the submitter chasing a colleague the other
     row already reached. */
  it("folds a mirrored pair into one outstanding entry, as the link fan-out folds it", () => {
    assert.match(POST_ROUTE, /seat\.value !== "trainer" \|\| zugleich === null/, "the outstanding list keeps the mirrored Trainer row");
    assert.match(POST_ROUTE, /rollenText\(\[seat\.value, "trainer"\]\)/, "the surviving row does not name both seats that person holds");
  });

  /* The token rides in a parameter spelled `token`, which is what the edge's redaction maps strip.
     One module spells it, so a rename cannot leave a second spelling the maps do not cover. */
  it("spells every link the one way the edge redacts", () => {
    const parameter = /\?(\w+)=/.exec(bestaetigungsLink("http://localhost:3000", "kein-echtes-token"))?.[1];

    assert.equal(parameter, "token", "the shared helper names a parameter the edge's maps do not strip");

    for (const [whose, sourceText] of [
      ["the submission handler", POST_ROUTE],
      ["the retention sweep", SWEEP],
      ["the administrator's re-send", ACTIONS],
    ] as const) {
      assert.match(sourceText, /bestaetigungsLink\(/, `${whose} no longer mints its link through the one helper`);
      assert.doesNotMatch(sourceText, /\/bestaetigung\?/, `${whose} spells a link of its own beside the helper`);
    }

    assert.doesNotMatch(POST_ROUTE, /console\.|logger\./, "the handler writes a line of its own, which the raw token could reach");
  });
});

describe("what stands in for a session on the session-less routes", () => {
  /** Every name Next reads as a route handler, so a method nobody anticipated is caught by the set rather than by a list. */
  const HTTP_METHODS: readonly string[] = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];

  // Every export form a handler can take, `export { GET }` included: a reader keyed on
  // `export async function` alone passes over the two spellings that are not one.
  const exportedNames = (sourceText: string): string[] => [
    ...[...sourceText.matchAll(/^export (?:async )?(?:function|const|let|var) (\w+)/gm)].map((hit) => hit[1] ?? ""),
    ...[...sourceText.matchAll(/^export \{([^}]*)\}/gm)].flatMap((hit) =>
      (hit[1] ?? "").split(",").map((eintrag) => (eintrag.split(" as ").pop() ?? "").trim()),
    ),
  ];

  /* Both files say „POST alone, and no GET“ in prose and nothing held them to it: a `GET` added
     later ships green, and a mail scanner fetching every link in a message would spend the token it
     fetched. */
  it("answers one method on each write, and that method is POST", () => {
    for (const [whose, sourceText] of [
      ["the application submit", POST_ROUTE],
      ["the confirmation write", CONFIRM_ROUTE],
    ] as const) {
      const names = exportedNames(sourceText);

      assert.ok(names.length > 0, `${whose} exports nothing this case can read, so the assertion below compares nothing`);
      assert.deepEqual(
        names.filter((name) => HTTP_METHODS.includes(name)),
        ["POST"],
        `${whose} answers a second method, which a mail scanner reaches with a fetch nobody made`,
      );
    }
  });

  /* `runAdminMutation`'s name says a session was checked. A public route reaching for it would read
     as authorized by something, and nothing here authorizes anything. */
  it("does not borrow the admin spine", () => {
    assert.doesNotMatch(POST_ROUTE, /runAdminMutation/, "a session-less route runs through the admin mutation spine");
    assert.match(POST_ROUTE, /handlePublicRequest\(request, \{/, "the route no longer runs through the public spine");
  });

  /* The one session-less route that takes NEITHER spine. `handlePublicRequest` always answers 200
     with the outcome in the body, which tells a provider that retries on non-200 that a forgery and
     an unreachable backend were both accepted. */
  it("keeps the delivery webhook off both spines, and off a session it has no caller for", () => {
    // The comments are cut first: this route's own doc block names both spines in order to say why
    // it takes neither, so a sweep over the whole file would read the argument as the defect.
    const code = ZUSTELLUNG_ROUTE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

    assert.doesNotMatch(code, /handlePublicRequest/, "the webhook answers every failure 200 through the public spine");
    assert.doesNotMatch(code, /getAdminSession|runAdminMutation/, "the webhook checks a session no provider holds");
    assert.match(ZUSTELLUNG_ROUTE, /status: 400/, "an unverifiable request is not refused with a status the provider stops retrying on");
    assert.match(ZUSTELLUNG_ROUTE, /status: 503/, "an unreachable backend is reported as an event the provider need not send again");
  });

  /* Parsing first and re-serialising changes key order and whitespace, and every real event then
     verifies as a forgery. */
  it("verifies the delivery webhook over the bytes the provider signed", () => {
    const raw = ZUSTELLUNG_ROUTE.indexOf("await request.text()");
    const parsedBody = ZUSTELLUNG_ROUTE.indexOf(".verify(");

    assert.notEqual(raw, -1, "the webhook reads something other than the raw request body");
    assert.ok(raw < parsedBody, "the body is parsed before it is verified");
    assert.ok(ZUSTELLUNG_ROUTE.indexOf("JSON.parse") > parsedBody, "an unverified body is parsed");
  });
});

describe("what one of the workflow's messages says about itself", () => {
  /* The tag block is what routes a delivery event back to the seat it belongs to; without it an
     event carries a message id this side has stored against nothing. */
  it("names the application every message of the workflow is about", () => {
    assert.equal(
      (POST_ROUTE.match(/auftrag: \{ bewerbungId: eingang\.created_id/g) ?? []).length,
      2,
      "one of the submission's two fan-outs goes out untagged",
    );
    assert.match(CONFIRM_ROUTE, /auftrag: \{ bewerbungId: antwort\.bewerbung_id/, "the confirmation's own message goes out untagged");
  });

  /* Both messages here carry a link minted for this one submission, so no second send can compose
     the same body: a key over a changed body is refused rather than collapsed. */
  it("passes no idempotency key with a message carrying a freshly minted token", () => {
    assert.doesNotMatch(POST_ROUTE, /idempotenzTag/, "the submission's link messages pass a key over a body that cannot repeat");
    assert.doesNotMatch(CONFIRM_ROUTE, /idempotenzTag/, "the confirmation's notice passes a key a second answer would be refused over");
  });
});

describe("how the form asks for a wished opponent", () => {
  const WISH = "Schule ohne Eintrag in der Liga";

  const WISH_MARKUP = renderMarkup(FormTeamSection, {
    trikot: { vorhandener_satz: "", wunschfarbe: null },
    kader: { voraussichtliche_groesse: null, gute_spieler: null },
    wunschgegner: WISH,
    schulen: SCHOOLS,
    vergebeneFarben: [],
    onTrikotChange: () => undefined,
    onKaderChange: () => undefined,
    onWunschgegnerChange: () => undefined,
    onFieldLeft: () => undefined,
    onFarbePicked: () => undefined,
  });

  /** The one element the submitted payload is read off, whatever HeroUI renders around it. */
  const carrier = /<(\w+)([^>]*\bname="wunschgegner"[^>]*)>/.exec(WISH_MARKUP);

  /* First: a control the section never rendered would leave every case below reading `null`, and the
     ones asking what it is NOT would pass over that. */
  it("renders the control, under a label naming the wish", () => {
    assert.notEqual(carrier, null, "the team section renders nothing carrying the payload's own field name");
    assert.match(WISH_MARKUP, /<label[^>]*>Wunschgegner[^<]*<\/label>/, "the control carries no label naming the wish");
  });

  /* Read off `FIELD_LABEL` rather than spelled here: a hand-typed size or weight drifts from the
     labels above it on the same panel, and the case above passes on the words alone. */
  it("dresses that label in the shared field-label style", () => {
    const labelAttrs = /<label ([^>]*)>Wunschgegner[^<]*<\/label>/.exec(WISH_MARKUP)?.[1] ?? "";
    const classesOf = (/class="([^"]*)"/.exec(labelAttrs)?.[1] ?? "").split(" ");

    assert.notEqual(labelAttrs, "", "the wish's label moved, so the loop below reads nothing");
    for (const classToken of FIELD_LABEL.split(" "))
      assert.ok(classesOf.includes(classToken), `the wish's label lost FIELD_LABEL's ${classToken}`);
  });

  /* The whole reason this is not a picker. A closed set moves the payload name onto a hidden input
     carrying the SELECTED KEY, so a school not already in the league submits an empty wish. */
  it("submits the typed name, which a closed set would drop", () => {
    const freeText = renderTree(
      h(
        ComboBox,
        { allowsCustomValue: true, name: "probe", inputValue: WISH },
        h(Label, null, "Probe"),
        h(ComboBox.InputGroup, null, h(Input, null), h(ComboBox.Trigger, null)),
      ),
    );
    const closedPages = renderTree(
      h(
        ComboBox,
        { name: "probe", inputValue: WISH },
        h(Label, null, "Probe"),
        h(ComboBox.InputGroup, null, h(Input, null), h(ComboBox.Trigger, null)),
      ),
    );

    const nameCarrier = (html: string) => /<input([^>]*\bname="probe"[^>]*)>/.exec(html)?.[1] ?? "";
    assert.match(nameCarrier(freeText), /role="combobox"/, "the control this case compares against changed shape");
    assert.match(nameCarrier(closedPages), /type="hidden"/, "a closed set now submits the typed text too, so this proves nothing");

    assert.match(carrier?.[2] ?? "", /role="combobox"/, "the wished opponent became a picker over the league's own clubs");
    assert.match(carrier?.[2] ?? "", new RegExp(`value="${WISH}"`), "the box submits something other than what was typed into it");
  });

  /* `name` IS the payload path: `<Form validationErrors>` distributes by it, so a refusal reaches
     this box only under the name the schema spells. */
  it("names the field as the payload spells it", () => {
    assert.equal(carrier?.[1], "input", "the payload's field name sits on something other than the text box");
  });

  /* A TYPED field is judged when it is LEFT: moved onto the change handler, the form would grade a
     name between two keystrokes. */
  it("judges it on blur rather than between keystrokes", async () => {
    const user = userEvent.setup();
    const onFieldLeft = mock.fn();
    render(
      h(FormTeamSection, {
        trikot: { vorhandener_satz: "", wunschfarbe: null },
        kader: { voraussichtliche_groesse: null, gute_spieler: null },
        wunschgegner: "",
        schulen: SCHOOLS,
        vergebeneFarben: [],
        onTrikotChange: () => undefined,
        onKaderChange: () => undefined,
        onWunschgegnerChange: () => undefined,
        onFieldLeft: onFieldLeft,
        onFarbePicked: () => undefined,
      }),
    );

    await user.type(screen.getByRole("combobox", { name: "Wunschgegner für den ersten Spieltag" }), "Goethe");
    assert.equal(onFieldLeft.mock.callCount(), 0, "the wish is judged between two keystrokes");

    await user.tab();
    assert.deepEqual(
      onFieldLeft.mock.calls.map(({ arguments: [pfade] }) => pfade),
      [["wunschgegner"]],
      "the wish is no longer judged when the field is left",
    );
  });

  /* The league's whole roster and never a season-scoped set: one growing with each acceptance would
     hand a late applicant the longer list. Opened on the running page, so the list the page read is
     the one that has to arrive. */
  it("suggests the league's clubs, the same list the school picker reads", async () => {
    const user = userEvent.setup();
    render(h(BewerbungView, { ...BASE_PROPS, fenster: FENSTER }));

    // By a fragment: react-aria names this trigger by its own label and the field's together.
    await user.click(screen.getByRole("button", { name: /Vorschläge anzeigen/ }));

    assert.deepEqual(
      within(screen.getByRole("listbox"))
        .getAllByRole("option")
        .map((option) => option.textContent.trim()),
      SCHOOLS.map(({ name }) => name),
      "the suggestions no longer come from the club list the page already read",
    );
  });
});

describe("which kit colours the wish picker leaves out", () => {
  const ASSIGNED = ["rot", "blau"] as const;

  /** The wish picker's own options, read where the submitted value comes from. */
  function offeredColours(html: string): string[] {
    const select = /<select[^>]*\bname="trikot\.wunschfarbe"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";

    return [...select.matchAll(/<option value="([^"]+)"/g)].map((hit) => hit[1] ?? "");
  }

  /* Three hops — page to view, view to form, form to picker — each droppable on its own, and each
     leaving the picker offering the whole palette with every gate green. */
  it("carries the assignments from the view down into the picker's own options", () => {
    const html = renderMarkup(BewerbungView, { ...BASE_PROPS, fenster: FENSTER, vergebeneFarben: ASSIGNED });
    const allColours = TRIKOT_FARBE_OPTIONS.map((option) => option.value);

    assert.ok(allColours.length > ASSIGNED.length, "the palette is no bigger than the assigned set, so this case compares nothing");
    assert.deepEqual(
      offeredColours(html),
      allColours.filter((colour) => !ASSIGNED.includes(colour as (typeof ASSIGNED)[number])),
      "the picker offers a colour the season has assigned, or drops one it has not",
    );
  });

  /* The whole palette while nothing is assigned, which is what a dropped prop looks like — so the
     case above only means something beside this one. */
  it("offers the whole palette where the season has assigned nothing", () => {
    assert.deepEqual(
      offeredColours(RUNNING_PAGE),
      TRIKOT_FARBE_OPTIONS.map((option) => option.value),
      "the picker withholds a colour nobody holds",
    );
  });

  /* Colours an administrator ASSIGNED, off the endpoint that answers `saison_teams.trikot_farbe`.
     Read off another application's `trikot.wunschfarbe` instead, the picker would carry one school's
     submission into another school's form. Which endpoint a page reads reaches no markup. */
  it("reads the season's assignments and no other application's wish", () => {
    assert.match(PAGE, /getBewerbungTrikotfarben\(saison_id\)/, "the page no longer reads which colours the season has assigned");
    assert.doesNotMatch(PAGE, /wunschfarbe/, "the application page reads a wish where it must read an assignment");
    assert.doesNotMatch(VIEW, /wunschfarbe/, "the application view reads a wish where it must read an assignment");
    assert.match(PAGE, /vergebeneFarben=\{vergeben\}/, "the page reads the assigned colours and hands them to nothing");
  });

  /* A failed read means "nothing is KNOWN to be taken", which offers the whole palette. Failing the
     other way would withhold a colour nobody holds -- and a wish is not unique in any case. */
  it("degrades to the empty set rather than to a narrowed palette", () => {
    // The CALL, never the import that names it first: the statement's own semicolon is what bounds
    // the read, and cut from the import the slice ends at the end of that line instead.
    const branch = PAGE.slice(PAGE.indexOf("await getBewerbungTrikotfarben"));

    assert.notEqual(branch, "", "the page no longer awaits the read this assertion is about");
    assert.match(branch.slice(0, branch.indexOf(";")), /\(\) => \[\]/, "an unreadable answer no longer offers the whole palette");
  });
});

describe("which of the confirmation page's words its stamped version covers", () => {
  const SLOTS = {
    schule: "Lessing-Kolleg",
    saison: "2026",
    rolle: "Ansprechperson",
    vorname: "Mira",
    ablehnen: ABLEHNEN_LABEL,
    minAlter: String(BEWERBUNG_MIN_ALTER),
    kontakt: KONTAKT_EMAIL,
    // The slot renders as a link, whose own words are what a reader sees in the sentence.
    datenschutz: "Datenschutzerklärung",
  };

  type Absatz = keyof typeof BESTAETIGUNG_ABSAETZE;

  const stamped = (key: Absatz): string => fuelleFassung(BESTAETIGUNG_ABSAETZE[key], SLOTS);

  /** Every paragraph and list item a render puts on the page, as a reader reads it. */
  const paragraphsOf = (html: string): string[] =>
    [...html.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((hit) => textOf(hit[2] ?? "").trim());

  /* The four components carrying the standing text, the armed decline's own paragraph among them, and
     nothing else: the panel around them words its own prose, which the version never covers. */
  const STANDING_TEXT = [
    renderMarkup(BestaetigungHinweise, { schule: SLOTS.schule, saison: SLOTS.saison, rolle: SLOTS.rolle, ablehnenLabel: ABLEHNEN_LABEL }),
    renderMarkup(WhatsappHinweis, {}),
    renderMarkup(KlickBestaetigung, { id: "klick-punkte", vorname: SLOTS.vorname, schule: SLOTS.schule, rolle: SLOTS.rolle }),
    renderMarkup(WiderspruchFolge, {}),
  ].join("");

  const FORM_PANEL = renderMarkup(BestaetigungFormPanel, {
    token: "kein-echtes-token",
    vorname: SLOTS.vorname,
    schule: SLOTS.schule,
    saison: SLOTS.saison,
    rolle: SLOTS.rolle,
    onAbschluss: () => undefined,
  });

  /* A record cites its label alone, so a paragraph the page spells for itself leaves that record
     claiming words its reader was never shown -- which is the whole of what the label is for. */
  it("renders no paragraph of its own beside the ones the version holds", () => {
    const version = new Set((Object.keys(BESTAETIGUNG_ABSAETZE) as Absatz[]).map(stamped));
    const renderedProps = paragraphsOf(STANDING_TEXT);

    assert.ok(renderedProps.length > 0, "the information text rendered nothing, so this case compares nothing");
    for (const paragraph of renderedProps)
      assert.ok(version.has(paragraph), `the page renders a paragraph the stamp does not cover: ${paragraph}`);
  });

  /* The other direction, which the case above cannot see: a paragraph nothing renders leaves the
     record citing more than its reader read. */
  it("renders every paragraph the version holds", () => {
    const renderedProps = new Set(paragraphsOf(STANDING_TEXT));

    for (const key of Object.keys(BESTAETIGUNG_ABSAETZE) as Absatz[]) {
      assert.ok(renderedProps.has(stamped(key)), `the version holds ${key}, which the page renders nowhere`);
    }
  });

  /* The switch is the one thing consented to rather than confirmed, and the button describes itself
     by the stamped points rather than a summary beside them, which read as a second promise. */
  it("takes the switch's label off that same version, and points the button at the stamped four", () => {
    const text = textOf(FORM_PANEL);
    const describedBy = [...FORM_PANEL.matchAll(/aria-describedby="([^"]*)"/g)].flatMap((hit) => (hit[1] ?? "").split(" "));

    assert.ok(text.includes(BESTAETIGUNG_KENNTNISNAHME.schalter), "the switch says something the stamped version does not hold");
    assert.ok(describedBy.length > 0, "no control on the form describes itself by anything at all");
    assert.ok(
      // Cut at the first close, which is this block's: the four points stand in a list, and no
      // element between the id and them opens a `div` of its own.
      describedBy.some((id) => {
        const describedFrom = FORM_PANEL.indexOf(`id="${id}"`);

        // As text: the reader's own values inside the points wear the emphasis, which splits the
        // stored sentence into runs of markup.
        return describedFrom !== -1 && textOf(FORM_PANEL.slice(describedFrom).split("</div>")[0] ?? "").includes(stamped("klickIdentitaet"));
      }),
      "no described element holds the stamped points, so the button promises something written nowhere",
    );
  });

  /* A stamped sentence copied into the panel's own prose leaves two wordings of one paragraph free to
     drift apart. Armed, the one state holding every paragraph: the objection's consequence opens under
     the armed press and nowhere else. */
  it("puts each stamped paragraph on the page exactly once", async () => {
    const { user, container } = renderBestaetigung();
    await user.click(screen.getByRole("button", { name: ABLEHNEN_LABEL }));

    const version = new Map((Object.keys(BESTAETIGUNG_ABSAETZE) as Absatz[]).map((key) => [stamped(key), key]));
    const counted = new Map<Absatz, number>();

    for (const paragraph of paragraphsOf(container.innerHTML)) {
      const key = version.get(paragraph);
      if (key !== undefined) counted.set(key, (counted.get(key) ?? 0) + 1);
    }

    assert.deepEqual(
      [...counted.keys()].sort(),
      (Object.keys(BESTAETIGUNG_ABSAETZE) as Absatz[]).sort(),
      "the armed form renders a stamped paragraph twice over, or drops one",
    );
    for (const [key, howOften] of counted) assert.equal(howOften, 1, `${key} stands on the page ${String(howOften)} times`);
  });
});

describe("how wide the confirmation page stands, and how many boxes it draws", () => {
  const OPENED_LINK = {
    acknowledged: 1,
    zustand: "gueltig",
    saison_id: "2026",
    schule: "Lessing-Kolleg",
    rolle: "ansprechperson",
    zugleich_rolle: null,
    vorname: "Mira",
    text_version: BESTAETIGUNG_KENNTNISNAHME.textVersion,
  } as const;

  /** The reader's own facts, each distinctive enough that finding one in the markup means this reader. */
  const OWN_VALUES = ["Mira", "Lessing-Kolleg", "2026", "Ansprechperson"];

  const SLOTS = {
    schule: OPENED_LINK.schule,
    saison: OPENED_LINK.saison_id,
    rolle: "Ansprechperson",
    vorname: OPENED_LINK.vorname,
    ablehnen: ABLEHNEN_LABEL,
    minAlter: String(BEWERBUNG_MIN_ALTER),
    kontakt: KONTAKT_EMAIL,
    datenschutz: "Datenschutzerklärung",
  };
  const STAMPED = new Set(Object.values(BESTAETIGUNG_ABSAETZE).map((text) => fuelleFassung(text, SLOTS)));

  const VALID_PAGE = renderMarkup(BestaetigungView, { start: { zustand: "gueltig", ansicht: OPENED_LINK, token: "kein-echtes-token" } });
  const STATE_PAGES = (["bestaetigt", "abgelehnt", "abgelaufen", "ungueltig", "unlesbar"] as const).map((zustand) => ({
    zustand: zustand,
    html: renderMarkup(BestaetigungView, { start: { zustand: zustand } }),
  }));

  /** A box a reader sees as one: the radius every panel recipe on this page carries, over a border. */
  const looksLikeBox = (classesOf: string): boolean => /(^| )rounded-2xl( |$)/.test(classesOf) && /(^| )border( |$)/.test(classesOf);

  const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

  /** How many of those boxes stand inside one another at the deepest point of one render. */
  function boxDepth(html: string): number {
    const openBoxes: boolean[] = [];
    let depth = 0;
    let deepest = 0;

    for (const hit of html.matchAll(/<(\/?)([a-zA-Z][^\s/>]*)([^>]*)>/g)) {
      const [, schraeg = "", tag = "", rest = ""] = hit;

      if (schraeg === "/") {
        if (openBoxes.pop() === true) depth -= 1;
        continue;
      }
      if (VOID_TAGS.has(tag.toLowerCase()) || rest.trimEnd().endsWith("/")) continue;

      const isBox = looksLikeBox(/class="([^"]*)"/.exec(rest)?.[1] ?? "");

      openBoxes.push(isBox);
      if (isBox) deepest = Math.max(deepest, (depth += 1));
    }

    return deepest;
  }

  /** Every passage a render puts on the page, whoever's words they are. */
  const allPassages = (html: string): string[] =>
    [...html.matchAll(/<(p|li|dd|h1|h2|h3|button|a)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((hit) => hit[2] ?? "");

  /** What the page says in its own words: the passages it draws, less the ones the stamped version owns. */
  function ownPassages(html: string): string[] {
    return allPassages(html).filter((passage) => !STAMPED.has(textOf(passage).trim()));
  }

  const withoutEmphasis = (passage: string): string => passage.replace(/<strong class="text-foreground font-bold">[\s\S]*?<\/strong>/g, "");

  /* The application form's page, not a card of its own: one column measures the same on both ends of
     the workflow, and a cap typed here is one nobody moves when that page's moves. */
  it("stands in the column the application page stands in", () => {
    assert.match(rootClass(RUNNING_PAGE), /max-w-meta/, "the application page no longer names the width this case compares against");
    assert.equal(rootClass(VALID_PAGE), rootClass(RUNNING_PAGE), "the confirmation page draws its own column rather than the shared one");
  });

  /* Nested boxes are what a phone pays for twice: each one spends the gutter again, and the words
     inside the innermost get what is left. */
  it("draws no panel inside a panel, in any state", () => {
    assert.equal(boxDepth(VALID_PAGE), 1, "the form's page draws no panel at all, or draws one inside another");

    for (const { zustand, html } of STATE_PAGES) {
      assert.equal(boxDepth(html), 1, `${zustand} draws no panel at all, or draws one inside another`);
    }
  });

  /* A page leaving a reader's own name in the run of the sentence reads as a form letter, where the
     emails set it in bold. **The stamped paragraphs too**: their slots are filled at the render site. */
  it("gives every value of the reader's own the page's one emphasis", () => {
    const passages = allPassages(VALID_PAGE);

    assert.ok(ownPassages(VALID_PAGE).length > 0, "the page renders no words of its own, so this case compares nothing");
    assert.ok(
      passages.some((passage) => OWN_VALUES.some((value) => textOf(passage).includes(value))),
      "no passage on the page names this reader at all",
    );

    for (const passage of passages) {
      const bare = textOf(withoutEmphasis(passage));

      for (const value of OWN_VALUES) {
        assert.ok(!bare.includes(value), `„${value}“ stands in the page's prose with nothing making it stand out: ${textOf(passage)}`);
      }
    }
  });

  /* One word for what a contact does to their own entry, the league's own „Absage“ being the other
     decision entirely. The stamped paragraphs keep their wording and are read past here. */
  it("calls a contact's refusal a Widerspruch wherever it names the act", async () => {
    const { user } = renderBestaetigung();
    await user.click(screen.getByRole("button", { name: ABLEHNEN_LABEL }));
    assert.ok(screen.getByRole("button", { name: /Widerspruch/ }), "the armed press no longer sends what the page calls it");

    for (const { zustand, html } of [{ zustand: "gueltig", html: VALID_PAGE }, ...STATE_PAGES]) {
      for (const passage of ownPassages(html)) {
        assert.doesNotMatch(textOf(passage), /ablehn/i, `${zustand} calls the act by the retired word: ${textOf(passage)}`);
      }
    }
  });
});

describe("how the confirmation page banners the facts a reader arrived with", () => {
  const ROWS = [
    { label: "Schule", wert: "Gymnasium an einer sehr langen Straße im Frankfurter Norden", unbegrenzt: true },
    { label: "Saison", wert: "2026" },
    { label: "Deine Rolle", wert: "Stellvertretung und Trainerin oder Trainer" },
  ];
  const BANNER = renderMarkup(FaktenBanner, { zeilen: ROWS });
  const classesOf = (markup: string): string[] => (/class="([^"]*)"/.exec(markup)?.[1] ?? "").split(/\s+/);

  /** Each fact's own box and its value, in the order the banner was handed them. */
  const cells = [...BANNER.matchAll(/<div (class="[^"]*")><dt[^>]*>[\s\S]*?<\/dt><dd([^>]*)>/g)].map(([, cell = "", value = ""]) => ({
    cell: classesOf(cell),
    value: classesOf(value),
  }));

  /* A phone has no pointer to hover a `title` with, so a value cut short there is read nowhere, and
     the two a phone cut were the school and the role. */
  it("reads every value whole, the school and the role included", () => {
    assert.equal(cells.length, ROWS.length, "the banner rendered a different number of facts than it was handed");
    assert.doesNotMatch(BANNER, /\stitle="/, "a value still parks its whole text in a tooltip");
    for (const { wert } of ROWS) assert.ok(textOf(BANNER).includes(wert), `„${wert}“ is not on the banner whole`);
  });

  /* The school is the value nothing bounds, and a name in one long word runs past the panel unless
     it may break mid-word. */
  it("breaks a long school name through the shared recipe rather than a copy of its classes", () => {
    // Read rather than rendered: a literal spelling those same classes renders identical markup, so
    // only the source separates the shared recipe from a copy of its output.
    assert.match(PANELS, /unbegrenzt: \{\s*\/\/[^\n]*\n\s*true: \{ zelle: "[^"]*", wert: NAME_WRAP \}/, "the banner spells the wrap itself");
    for (const classToken of NAME_WRAP.split(" ")) {
      assert.doesNotMatch(
        PANELS,
        new RegExp(`"[^"]*\\b${classToken.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")}\\b`),
        `a second spelling of ${classToken} is back`,
      );
    }
  });

  /* Sized to the two values it reads back: spread across the panel, the second sits alone at the
     far edge and reads as a column that lost its table. */
  it("sizes the receipt's stored values to their content", () => {
    const storedMarkup = renderMarkup(GespeicherteAngaben, {
      zeilen: [
        { label: "Geburtsdatum", wert: "01.09.2008" },
        { label: "WhatsApp", wert: "erlaubt" },
      ],
    });
    const rootClasses = /class="([^"]*)"/.exec(storedMarkup)?.[1] ?? "";

    assert.doesNotMatch(rootClasses, /justify-between|w-full/, "the stored values are spread across the panel rather than sized to themselves");
    assert.doesNotMatch(storedMarkup, /flex-1/, "a stored value takes an equal share of the width rather than its own");
    for (const value of ["01.09.2008", "erlaubt"]) {
      assert.ok(storedMarkup.includes(`<strong class="text-foreground font-bold">${value}</strong>`), `${value} wears no emphasis`);
    }
  });
});

describe("how the confirmation page names a person entered in two seats", () => {
  const pageFor = (rolle: FLKontaktRolle, zugleich_rolle: FLKontaktRolle | null): string =>
    renderMarkup(BestaetigungView, {
      start: {
        zustand: "gueltig",
        token: "kein-echtes-token",
        ansicht: {
          acknowledged: 1,
          zustand: "gueltig",
          saison_id: "2026",
          schule: "Lessing-Kolleg",
          rolle: rolle,
          zugleich_rolle: zugleich_rolle,
          vorname: "Mira",
          text_version: BESTAETIGUNG_KENNTNISNAHME.textVersion,
        },
      },
    });

  const roleInBanner = (markup: string): string => textOf(/<dt[^>]*>Deine Rolle<\/dt><dd[^>]*>([\s\S]*?)<\/dd>/.exec(markup)?.[1] ?? "");
  const BOTH_SEATS = /Deine Antwort gilt für beide Einträge\./;

  /* Either of the two links answers both seats, so both read the one phrase the mail names them by. */
  it("banners both seats in one order, whichever of the two links was opened", () => {
    for (const [rolle, zugleich] of [
      ["stellvertretung", "trainer"],
      ["trainer", "stellvertretung"],
    ] as const) {
      assert.equal(
        roleInBanner(pageFor(rolle, zugleich)),
        "Stellvertretung und Trainerin oder Trainer",
        `the ${rolle} link names the pair otherwise`,
      );
    }
  });

  it("says the answer covers both entries, and says nothing of the kind to a single seat", () => {
    const singleSeatPage = pageFor("ansprechperson", null);

    assert.match(
      textOf(pageFor("ansprechperson", "trainer"), " "),
      BOTH_SEATS,
      "a person holding two seats is not told one answer covers both",
    );
    assert.equal(roleInBanner(singleSeatPage), "Ansprechperson", "a single seat is named as something else");
    assert.doesNotMatch(textOf(singleSeatPage, " "), BOTH_SEATS, "a single seat is told of a second entry it does not have");
  });
});

describe("what arming the objection is allowed to move on the confirmation page", () => {
  /* Withdrawing the two controls is what walked the button row up the page under the pointer that had
     just armed it; held, they keep their place and the row keeps its two presses. */
  it("asks for the same fields and seats the same presses, armed as unarmed", async () => {
    const { user } = renderBestaetigung();
    /** Everything the panel asks a value of and everything it offers to press, counted by role. */
    const asked = () => ({
      felder: screen.queryAllByRole("group", { name: "Dein Geburtsdatum" }).length + screen.queryAllByRole("switch").length,
      knoepfe: screen.getAllByRole("button").length,
    });
    const restingState = asked();

    assert.ok(restingState.felder > 0, "the unarmed form renders no control at all, so the comparison below compares nothing");
    // The calendar's own trigger beside the two presses: it stands outside the action row and stays.
    assert.equal(restingState.knoepfe, 3, "the unarmed panel offers something other than the calendar and the two presses");

    await user.click(screen.getByRole("button", { name: ABLEHNEN_LABEL }));

    assert.deepEqual(asked(), restingState, "arming the objection takes a control or a press off the page");
  });
});

describe("where the confirmation page shows a refusal it cannot put at a field", () => {
  /* A refusal naming only `token`, `antwort` or the stamped label reaches no control, so it is shown
     nowhere unless something announces it, and announced twice it reads as two failures; one naming a
     rendered field speaks there. */
  it("raises one danger toast whenever the refusal named no rendered path", async () => {
    /* ONE title, whichever site announces it: the shared reader takes this page's own word for a
       failed save (`fl_frontend/src/shared/hooks/useServerFieldErrors.ts`), so a reader meeting the
       two refusals below meets one name for what went wrong rather than two. */
    const cases: [string, Record<string, string> | undefined, string[]][] = [
      ["a refusal on the token alone", { token: "Dieser Link ist nicht mehr gültig." }, ["Antwort nicht gespeichert"]],
      ["a refusal naming no field at all", undefined, ["Antwort nicht gespeichert"]],
      ["a refusal on the birth date", { geburtsdatum: "Bitte gib ein gültiges Datum ein." }, []],
    ];
    for (const [named, fieldErrors, expectedTitles] of cases) {
      raised.length = 0;
      fetchMock.mock.mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ success: false, error: "Überprüfe Deine Eingaben.", fieldErrors }))),
      );
      const { user, unmount } = renderBestaetigung();

      // The objection, sent past the guard a confirmation's empty fields would stop at; the route answers both alike.
      await pressTwice(user, { resting: ABLEHNEN_LABEL, armed: /Widerspruch/ });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      assert.deepEqual(
        raised.filter((toast) => toast.variant === "danger").map((toast) => toast.title),
        expectedTitles,
        `${named} is announced otherwise`,
      );
      unmount();
    }
  });
});

describe("where a link answered in another window lands", () => {
  const panelText = (zustand: LinkZustand): string => textOf(renderMarkup(BestaetigungView, { start: { zustand: zustand } }));

  /* The two answers have to read differently, which is the whole of what the second read buys: told
     „bestätigt“, a person who objected believes the entry they refused is standing. */
  it("gives a confirmed seat and one that was objected to different words", () => {
    const confirmedPanel = panelText("bestaetigt");
    const widersprochen = panelText("abgelehnt");

    assert.notEqual(confirmedPanel, widersprochen, "both answers render one panel, so the read has nothing to distinguish");
    assert.match(widersprochen, /widersprochen/, "the objected panel no longer says the entry was refused");
    assert.doesNotMatch(confirmedPanel, /widersprochen/, "the confirmed panel talks about an objection");
  });

  /*
   Read rather than rendered, for the reason the session-less block above gives: this is the
   handler's control flow, and the state it picks reaches the browser as JSON.
  */
  it("reads the link's standing instead of naming a state the refusal cannot tell apart", () => {
    assert.match(CONFIRM_ROUTE, /getEinwilligungAnsicht\(token\)/, "the handler answers a state it guessed from the refusal code");
    assert.match(CONFIRM_ROUTE, /nachlesen === true/, "the handler no longer branches on the refusal that asks for the read");
  });

  /* Destructured out, never spread with the rest: `nachlesen` is this handler's own instruction, and
     the page has no arm for it. */
  it("keeps that instruction out of what the browser is answered", () => {
    assert.match(CONFIRM_ROUTE, /const \{ nachlesen, \.\.\.panel \} = refusal;/, "the refusal reaches the answer whole");
    assert.doesNotMatch(CONFIRM_ROUTE, /\.\.\.refusal/, "the refusal is spread into the answer, its instruction with it");
  });
});

/*
 Read rather than rendered, for the reason the session-less block above gives: a route handler
 composes a message and an answer, and neither becomes markup a renderer could be pointed at.
*/
describe("what one answered seat sets the confirmation route sending", () => {
  /* The LAST seat, never any confirmation: told „vollständig“ while two seats are open, a submitter
     stops chasing the people the application is still waiting for. */
  it("calls the application complete only where the answer leaves no seat outstanding", () => {
    assert.match(
      CONFIRM_ROUTE,
      /antwort\.ergebnis === "bestaetigt" && antwort\.ausstehend\.length === 0/,
      "the completeness message is sent on a condition that is not the last seat landing",
    );
  });

  /* `Absage` is the league's own rejection of a whole application and carries an administrator's
     stated reason; a seat's refusal is a `Widerspruch`, and the two read as different decisions. */
  it("sends the seat's own decline notice rather than the league's rejection", () => {
    assert.match(CONFIRM_ROUTE, /buildBewerbungWiderspruchEmail/, "the decline no longer composes the message written for it");
    assert.doesNotMatch(CONFIRM_ROUTE, /buildBewerbungAbsageEmail/, "a seat's refusal is reported as the league turning the school down");
  });

  /* The one branch with nowhere to send: the seat that would have been addressed is the seat that
     just emptied itself, and any substitute recipient is a third party. */
  it("sends nothing where the Ansprechperson seat is empty, and logs neither address nor token", () => {
    const branch = CONFIRM_ROUTE.slice(CONFIRM_ROUTE.indexOf("ansprechperson_email === null"));
    const upToSend = branch.slice(0, branch.indexOf("await sendBewerbungMail"));
    // The call's own arguments, which is what reaches the stream; the comment above it is prose.
    const logLine = /logger\.info\(([\s\S]*?)\);/.exec(upToSend)?.[1] ?? "";

    assert.notEqual(branch, "", "the handler no longer answers an empty Ansprechperson seat at all");
    assert.match(upToSend, /return;/, "the empty branch falls through into the send");
    assert.notEqual(logLine, "", "the empty seat passes without a line saying the message went nowhere");
    assert.doesNotMatch(logLine, /ansprechperson_email|token|vorname/, "the line carries an address, a token or a person");
  });

  /* The label names which words the confirming person read, so a body's own value is a claim no
     browser may make: a caller could otherwise file a record under a retired wording, or one
     nobody ever wrote. */
  it("stamps the registry's own label over whatever label the body carried", () => {
    const foreignBody = {
      token: "kein-echtes-token",
      antwort: "erteilt",
      geburtsdatum: "1984-05-09",
      whatsapp: false,
      text_version: "2019-01-erfunden",
    };
    // The handler's own two steps, in its order: the stamp rewrites the body, and the schema judges
    // what the stamp produced.
    const stamped = FLBewerbungEinwilligungAntwortPayloadSchema.parse(stampEinwilligungFassung(foreignBody));

    assert.equal(stamped.text_version, BESTAETIGUNG_KENNTNISNAHME.textVersion);
    assert.match(CONFIRM_ROUTE, /stampEinwilligungFassung\(body\)/, "the browser's own label reaches the endpoint");
    assert.doesNotMatch(CONFIRM_ROUTE, /safeParse\(body\)/, "the body is judged before its label is replaced");
  });

  /* Judged first, a body carrying no label is refused on `text_version` — a path no control renders,
     so the refusal reaches the reader as nothing at all. */
  it("admits a body that names no label, the stamp having written one", () => {
    const withoutVersion = { token: "kein-echtes-token", antwort: "erteilt", geburtsdatum: "1984-05-09", whatsapp: false };

    assert.equal(
      FLBewerbungEinwilligungAntwortPayloadSchema.safeParse(withoutVersion).success,
      false,
      "the label is optional, so the stamp's position decides nothing",
    );
    assert.equal(FLBewerbungEinwilligungAntwortPayloadSchema.safeParse(stampEinwilligungFassung(withoutVersion)).success, true);
  });

  /* The switch is hidden while a decline is armed, so a `true` here is a drifted client rather than
     a press: taken, the echo would report a scope the emptied slot records nowhere. */
  it("refuses a decline that carries the WhatsApp consent, at the shape both tiers judge", () => {
    const abgelehnt = {
      token: "kein-echtes-token",
      antwort: "abgelehnt",
      geburtsdatum: null,
      text_version: BESTAETIGUNG_KENNTNISNAHME.textVersion,
    };
    const refused = FLBewerbungEinwilligungAntwortPayloadSchema.safeParse({ ...abgelehnt, whatsapp: true });

    assert.equal(refused.success, false, "a decline carrying a consent is admitted");
    assert.deepEqual(
      refused.error?.issues.map((issue) => issue.path.join(".")),
      ["whatsapp"],
      "the refusal lands somewhere other than the switch",
    );
    assert.equal(FLBewerbungEinwilligungAntwortPayloadSchema.safeParse({ ...abgelehnt, whatsapp: false }).success, true);
  });

  /* The address exists on this tier and must not leave it: the answer is composed key by key so a
     later field on the response cannot ride out to the browser by being spread. */
  it("answers the browser four named fields and no part of the mail", () => {
    const answerLiteral = /return \{ success: true as const,([^}]*)\}/.exec(CONFIRM_ROUTE)?.[1] ?? "";

    assert.notEqual(answerLiteral, "", "the success answer is no longer a literal this can read");
    assert.deepEqual(
      [...answerLiteral.matchAll(/(\w+):/g)].map((hit) => hit[1]),
      ["ergebnis", "geburtsdatum", "whatsapp"],
      "the browser is answered something other than the seat's own three fields",
    );
    assert.doesNotMatch(answerLiteral, /\.\.\./, "the answer spreads the response, so every server-only field travels with it");
  });
});
