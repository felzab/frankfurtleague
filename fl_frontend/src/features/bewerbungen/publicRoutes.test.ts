import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { KONTAKT_EMAIL } from "@/core/brand.ts";
import { BESTAETIGUNG_ABSAETZE, BESTAETIGUNG_EINWILLIGUNG, fuelleFassung } from "@/core/einwilligung.ts";
import { FIELD_LABEL } from "@/shared/components/ui/formFieldStyles.ts";
import { renderMarkup, renderTree, textOf } from "@/shared/testing/renderTest";

import { bestaetigungsLink } from "./bestaetigungLink.ts";
import { BEWERBUNG_MIN_ALTER, BEWERBUNG_SEATS } from "./constants.ts";

import type { FLBewerbungFensterResponse } from "./schemas.ts";
import type { LinkZustand } from "./types.ts";

/*
 Every module below is reached AFTER the harness above has evaluated, because that is when the JSX
 compile step is registered; a static import beside it resolves first and dies on the extension.
*/
const { ComboBox, Input, Label } = await import("@heroui/react");
const { BewerbungView } = await import("./components/views/BewerbungView.tsx");
const { FormTeamSection } = await import("./components/forms/BewerbungForm/FormTeamSection.tsx");
const { KontaktView } = await import("@/features/meta/components/views/KontaktView.tsx");
const { ContentLoader } = await import("@/shared/components/ui/ContentLoader.tsx");
const { default: BewerbungLoading } = await import("@/app/(public)/bewerbung/[saison_id]/loading.tsx");
const { default: BewerbungPage } = await import("@/app/(public)/bewerbung/[saison_id]/page.tsx");
const { default: LandingPage } = await import("@/app/(public)/page.tsx");
const { default: KontaktPage } = await import("@/app/(public)/(meta)/kontakt/page.tsx");
const { BewerbungBandSkeleton } = await import("./components/ui/BewerbungBandSkeleton.tsx");
const { ctaButton } = await import("@/shared/components/ui/formButtons.ts");
const { formPanel } = await import("@/shared/components/ui/formPanel.ts");
const { TRIKOT_FARBE_OPTIONS } = await import("@/features/teams/constants.ts");
const { fensterZustand, stampEinwilligungFassung } = await import("./utils.ts");
const { FLBewerbungEinwilligungAntwortPayloadSchema } = await import("./schemas.ts");
const { ABLEHNEN_LABEL, BESTAETIGUNG_FELDER, BestaetigungAngaben, BestaetigungEntscheidung, BestaetigungFormPanel, WIDERSPRUCH_SENDEN } =
  await import("./components/views/BestaetigungFormPanel.tsx");
const { BestaetigungHinweise, KlickBestaetigung, WhatsappHinweis, WiderspruchFolge } =
  await import("./components/views/BestaetigungHinweise.tsx");
const { FaktenBanner } = await import("./components/views/BestaetigungPanels.tsx");
const { BestaetigungView } = await import("./components/views/BestaetigungView.tsx");

const FRONTEND_DIR = path.resolve(import.meta.dirname, "..", "..", "..");
const SRC_DIR = path.join(FRONTEND_DIR, "src");
const APP_DIR = path.join(SRC_DIR, "app");
const ROUTE_DIR = path.join(APP_DIR, "(public)", "bewerbung", "[saison_id]");

const LANDING = readFileSync(path.join(APP_DIR, "(public)", "page.tsx"), "utf8");
const PAGE = readFileSync(path.join(ROUTE_DIR, "page.tsx"), "utf8");
const VIEW = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "views", "BewerbungView.tsx"), "utf8");
const NEXT_CONFIG = readFileSync(path.join(FRONTEND_DIR, "next.config.ts"), "utf8");
const BAND = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "ui", "BewerbungOffenBand.tsx"), "utf8");
const SKELETON = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "ui", "BewerbungBandSkeleton.tsx"), "utf8");
const KONTAKT_PAGE = readFileSync(path.join(APP_DIR, "(public)", "(meta)", "kontakt", "page.tsx"), "utf8");
const POST_ROUTE = readFileSync(path.join(APP_DIR, "api", "bewerbung", "route.ts"), "utf8");
const CONFIRM_ROUTE = readFileSync(path.join(APP_DIR, "api", "bestaetigung", "route.ts"), "utf8");
const SWEEP = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "sweep.ts"), "utf8");
const ACTIONS = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "actions.ts"), "utf8");
const CONFIRM_PANEL = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "views", "BestaetigungFormPanel.tsx"), "utf8");
const PUBLIC_ROUTE = readFileSync(path.join(SRC_DIR, "shared", "utils", "publicRoute.ts"), "utf8");
const UNDO_ROUTE = readFileSync(path.join(SRC_DIR, "shared", "utils", "undoRoute.ts"), "utf8");
const FORM = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "forms", "BewerbungForm", "BewerbungForm.tsx"), "utf8");
const TEAM_SECTION = readFileSync(
  path.join(SRC_DIR, "features", "bewerbungen", "components", "forms", "BewerbungForm", "FormTeamSection.tsx"),
  "utf8",
);

/**
 * The `saison` slot per ground, each cut out so an assertion reads that arm and nothing near it. The BASE is
 * shared, so a colour there reaches both pages; only the landing arm may name one.
 */
const BASE_SAISON = /saison: "([^"]*)"/.exec(BAND)?.[1] ?? "";
const SURFACE_SAISON = /surface: \{[^}]*saison: "([^"]*)"/.exec(BAND)?.[1] ?? "";
const FIELD_ARM = /field: \{([^}]*)\}/.exec(BAND)?.[1] ?? "";
const FIELD_SAISON = /saison: "([^"]*)"/.exec(FIELD_ARM)?.[1] ?? "";

/** Names no school the placeholders already carry, so a hit is the list rather than a hint text. */
const SCHULEN = [
  { id: "68d0f2a4c1e2b3a4d5e6f708", name: "Lessing-Kolleg" },
  { id: "68d0f2a4c1e2b3a4d5e6f709", name: "Riedberg-Oberstufe" },
] as const;

const HEUTE = "2026-04-01";
const FENSTER: FLBewerbungFensterResponse = {
  acknowledged: 1,
  saison_id: "2026",
  offen: true,
  von: "2026-03-01",
  bis: "2026-04-30",
  laeuft: true,
};

const ANSICHT = { saisonId: "2026", isUnlesbar: false, today: HEUTE, schulen: SCHULEN, isSchulenLesbar: true, vergebeneFarben: [] };

/** One prop set per window state, named by `fensterZustand` itself rather than by a label typed here. */
const ZUSTAENDE = [
  { ...ANSICHT, fenster: FENSTER },
  { ...ANSICHT, fenster: { ...FENSTER, laeuft: false, von: "2026-05-01", bis: "2026-05-31" } },
  { ...ANSICHT, fenster: { ...FENSTER, laeuft: false, offen: false } },
  { ...ANSICHT, fenster: { ...FENSTER, laeuft: false, von: "2026-01-01", bis: "2026-02-01" } },
  { ...ANSICHT, fenster: null },
  { ...ANSICHT, fenster: null, isUnlesbar: true },
].map((props) => ({
  zustand: props.isUnlesbar ? "unlesbar" : fensterZustand(props.fenster, props.today),
  html: renderMarkup(BewerbungView, props),
}));

const LAEUFT = ZUSTAENDE.find((eintrag) => eintrag.zustand === "laeuft")?.html ?? "";
const GESCHLOSSEN = ZUSTAENDE.find((eintrag) => eintrag.zustand === "geschlossen")?.html ?? "";

/** The outermost element's class list, which is where a recipe lands — read inside its own tag alone. */
const wurzelKlasse = (html: string): string => /class="([^"]*)"/.exec(html.slice(0, html.indexOf(">")))?.[1] ?? "";

/** Every link the header renders, as a reader meets it: where it goes, how it is dressed, what it says. */
function kopfLinks(html: string): { href: string; klassen: string; text: string; ikonen: string[] }[] {
  const nav = /<nav\b[^>]*>([\s\S]*?)<\/nav>/.exec(html)?.[1] ?? "";

  return [...nav.matchAll(/<a ([^>]*)>([\s\S]*?)<\/a>/g)].map((treffer) => ({
    href: /href="([^"]*)"/.exec(treffer[1] ?? "")?.[1] ?? "",
    klassen: /class="([^"]*)"/.exec(treffer[1] ?? "")?.[1] ?? "",
    text: textOf(treffer[2] ?? "").trim(),
    ikonen: [...(treffer[2] ?? "").matchAll(/<path[^>]*\bd="([^"]*)"/g)].map((pfad) => pfad[1] ?? ""),
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

describe("the window state the application page renders", () => {
  /* First: every case below reads these renders, and a props table that had collapsed onto one state
     would leave each of them asserting over the same page six times. */
  it("renders each of the six states the page has an answer for", () => {
    assert.deepEqual(
      [...ZUSTAENDE.map((eintrag) => eintrag.zustand)].sort(),
      ["geschlossen", "keine-frist", "laeuft", "noch-nicht", "unlesbar", "vorbei"],
      "the fixtures no longer put the page into one state each",
    );
  });

  /* „Trag Dein Team hier ein“ above a panel saying the window is shut is the page contradicting
     itself, and the invitation and the form can drift onto different conditions. */
  it("invites an application on the one state that renders a form", () => {
    const eingeladen = ZUSTAENDE.filter(({ html }) => html.includes("Trag Dein Team hier ein"));
    const mitForm = ZUSTAENDE.filter(({ html }) => html.includes('name="team_id"'));

    assert.deepEqual(
      eingeladen.map((eintrag) => eintrag.zustand),
      ["laeuft"],
      "the invitation renders in a state that shows no form",
    );
    assert.deepEqual(
      mitForm.map((eintrag) => eintrag.zustand),
      ["laeuft"],
      "a state that cannot take an application renders the form anyway",
    );
  });

  /* The lead is the one site: the receipt panel and the three mails carry the fact from the press
     onwards, so a second wording above the button is one promise said twice. */
  it("says in the lead, and only there, what the press sets in motion", () => {
    assert.ok(
      LAEUFT.includes("Nach dem Abschicken bekommt jede Kontaktperson eine E-Mail"),
      "the running state never says what the press sets in motion",
    );
    assert.doesNotMatch(LAEUFT, /Mit dem Abschicken/, "the page repeats the press's consequence above the submit");
    // One noun for one link on both sites, the E-Mail fields' own hint included: „Link zur
    // Einwilligung“ beside „Link zur Bestätigung“ reads as two different links.
    assert.doesNotMatch(LAEUFT, /Link zur Einwilligung/, "the two sites name the link differently from the field hint");
  });

  /* A closed window renders the page rather than a 404, so every closed state owes the reader a
     sentence of its own — an empty body reads as a page that failed to load. */
  it("answers every closed state with a heading of its own", () => {
    const geschlossen = ZUSTAENDE.filter(({ zustand }) => zustand !== "laeuft");
    const ueberschriften = geschlossen.map(({ html }) => /<h2[^>]*>([^<]*)<\/h2>/.exec(html)?.[1] ?? "");

    for (const [index, titel] of ueberschriften.entries()) {
      assert.notEqual(titel, "", `${geschlossen[index]?.zustand ?? ""} renders no answer at all`);
    }
    assert.equal(new Set(ueberschriften).size, ueberschriften.length, "two closed states give the reader the same answer");
  });
});

describe("the links the application page's header offers", () => {
  /* A header offering nothing is the failure the assertions below cannot see: they would all pass
     over an empty list. */
  it("renders all three of them, in order", () => {
    assert.deepEqual(
      kopfLinks(LAEUFT).map((link) => link.href),
      ["/about", "/kontakt", "/dashboard"],
      "the header no longer offers About, Kontakt and the dashboard",
    );
  });

  /* Driven off the RENDERED hrefs, so a link this suite has never seen is checked too. Whether a
     path is answered is the router tree's answer and appears in no markup. */
  it("lands somewhere for every href it renders", () => {
    for (const { href } of kopfLinks(LAEUFT)) {
      assert.ok(isRouteAnswered(href), `${href} has neither a page nor a redirect`);
    }
  });

  /* `?saison_id=` here would pin the link to the season being APPLIED for, which is a future one the
     dashboard withholds. Bare, the redirect resolves the running season instead. */
  it("leaves the dashboard link unparameterised, and says which season it opens", () => {
    const dashboard = kopfLinks(LAEUFT).find((link) => link.href.startsWith("/dashboard"));

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
    const nav = /<nav\b[^>]*>([\s\S]*?)<\/nav>/.exec(LAEUFT)?.[1] ?? "";
    const anlaesse = [...nav.matchAll(/<span[^>]*>([^<]+)<\/span><a /g)].map((treffer) => (treffer[1] ?? "").trim());
    const ikonen = kopfLinks(LAEUFT).flatMap((link) => link.ikonen);

    assert.equal(anlaesse.length, 3, "a header link renders no reason directly above it");
    for (const anlass of anlaesse) assert.notEqual(anlass, "", "a header link's reason renders as nothing");
    assert.equal(ikonen.length, 3, "a header link renders no icon, or renders two");
    assert.equal(new Set(ikonen).size, 3, "two header links draw the same glyph, so the pair cannot be told apart");
  });

  /* The outline treatment is what makes them equal. A `primary` among them would rank one above the
     other two, which is the hierarchy these three deliberately do not have. */
  it("dresses all three in the outline recipe rather than promoting one", () => {
    const outline = ctaButton({ intent: "outline", size: "sm", hover: "css" }).split(" ");
    const primary = ctaButton({ intent: "primary", size: "sm", hover: "css" }).split(" ");
    // The classes the fill has and the outline has not, so this survives a retokenised recipe.
    const nurPrimary = primary.filter((klasse) => !outline.includes(klasse));

    assert.notEqual(nurPrimary.length, 0, "the two treatments render alike, so this case compares nothing");
    for (const link of kopfLinks(LAEUFT)) {
      const klassen = link.klassen.split(" ");

      for (const klasse of outline) assert.ok(klassen.includes(klasse), `${link.href} lost the outline recipe's ${klasse}`);
      for (const klasse of nurPrimary) assert.ok(!klassen.includes(klasse), `${link.href} was promoted above the other two`);
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
    const panel = /<div class="([^"]*)"><h2/.exec(GESCHLOSSEN)?.[1] ?? "";

    assert.notEqual(panel, "", "the closed state renders no panel this case can read");
    for (const klasse of formPanel().root().split(" ")) {
      assert.ok(panel.split(" ").includes(klasse), `the state panel's box is missing formPanel's ${klasse}`);
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
    const region = wurzelKlasse(renderMarkup(ContentLoader, {}));
    const viewport = wurzelKlasse(renderMarkup(ContentLoader, { fills: "viewport" as const }));

    assert.notEqual(region, viewport, "the two fills render alike, so this case compares nothing");
    assert.equal(wurzelKlasse(renderMarkup(BewerbungLoading, {})), viewport, "the route's loading.tsx stops short of the footer");
  });

  /* The streamed half is the page's own boundary: everything inside it awaits, so a render of the
     page draws the fallback and nothing else, which is the state a reader meets first. */
  it("fills the viewport on a stream", () => {
    const region = wurzelKlasse(renderMarkup(ContentLoader, {}));
    const viewport = wurzelKlasse(renderMarkup(ContentLoader, { fills: "viewport" as const }));
    const gestreamt = renderMarkup(BewerbungPage, { params: Promise.resolve({ saison_id: "2026" }), searchParams: Promise.resolve({}) });

    assert.notEqual(region, viewport, "the two fills render alike, so this case compares nothing");
    assert.equal(wurzelKlasse(gestreamt), viewport, "the page's boundary stops short of the footer");
    /* Read beside the render: a `<div>` spelling the loader's own classes renders the same markup, so
       only the source says the boundary holds the component rather than a copy of its output. */
    assert.match(PAGE, /fallback=\{<ContentLoader fills="viewport" \/>\}/, "the page's boundary no longer holds a ContentLoader");
  });
});

/*
 Read rather than rendered: what is asserted is which arm of the band's recipe a colour sits in, and
 which page asks for which arm — a rendered class list is one flat string that names neither.
*/
describe("how the band writes the season it is inviting applications for", () => {
  /* Read from the LANDING arm, never the base: the base deliberately carries no colour, so an assertion
     aimed there would be satisfied by a recipe that had dropped the brand altogether. */
  it("tints the season with the brand itself", () => {
    assert.match(SURFACE_SAISON, /(^|\s)text-brand(\s|$)/, "the landing band no longer writes the season in the brand colour");
  });

  /* The pitch reads no brand at all — 1.32:1 light, 3.05:1 dark — so that ground names no colour and the
     phrase takes the band's own foreground. Fill or text alike: both are a colour. */
  it("puts no colour on the season on the pitch", () => {
    assert.notEqual(FIELD_ARM, "", "the pitch ground moved, so the two assertions below read nothing");
    assert.doesNotMatch(BASE_SAISON, /(^|\s)(text|bg)-/, "a colour on the shared slot reaches the pitch too");
    assert.doesNotMatch(FIELD_SAISON, /(^|\s)(text|bg)-/, "the pitch band put a colour back on the season");
  });

  /* Two pages, two grounds: the landing card and the `(meta)` pitch. One forced ground is what put a
     pale rectangle into the pitch, which is the thing this variant exists to stop. */
  it("offers a ground for each page the slot appears on", () => {
    assert.match(BAND, /ground: \{/, "the band forces one ground on both pages again");
    assert.match(BAND, /surface: \{ root: "border-border bg-surface/, "the landing band lost its own card ground");
    assert.match(BAND, /field: \{ root: "soccer-field-card-bg/, "the contact band no longer takes the pitch card's ground");
    assert.match(BAND, /defaultVariants: \{ ground: "surface" \}/, "a band that names no ground stops defaulting to the landing card");
  });

  /* The pitch ground is the contact page's, and only that page may ask for it. */
  it("seats the contact page's band on the pitch ground", () => {
    assert.match(KONTAKT_PAGE, /<BewerbungOffenBand ground="field" \/>/, "the contact band no longer asks for the pitch ground");
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
    assert.match(SKELETON, /band\(\{ ground: ground \}\)/, "the skeleton restates the band's box instead of reading it");
    assert.match(SKELETON, /ctaButton\(\{/, "the skeleton restates the control's height instead of reading it");
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
  /* Under the page's own heading and description, above everything else: a band below the opening
     block is one a reader meets after they have already read past the reason to press it. */
  it("renders the slot between the description and the first separator", () => {
    const html = renderMarkup(KontaktView, { bewerbungSlot: h("div", { "data-band": "" }, "BEWERBUNGSSLOT") });
    const slot = html.indexOf("BEWERBUNGSSLOT");
    const beschreibung = html.indexOf("offenes Ohr");
    const trenner = html.indexOf("soccer-field-separator");

    assert.notEqual(slot, -1, "the view renders no band slot at all");
    assert.notEqual(beschreibung, -1, "the view renders no description, so the bound below reads nothing");
    assert.notEqual(trenner, -1, "the view renders no separator, so the bound below reads nothing");
    assert.ok(slot > beschreibung, "the band sits above the heading and description");
    assert.ok(slot < trenner, "the band sits below the opening block instead of under the description");
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
    assert.match(POST_ROUTE, /link: bestaetigungsLink\(seats\.ansprechperson\)/, "the receipt carries no link of its own");
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
    const parameter = /\?(\w+)=/.exec(bestaetigungsLink("kein-echtes-token"))?.[1];

    assert.equal(parameter, "token", "the shared helper names a parameter the edge's maps do not strip");

    for (const [wer, quelle] of [
      ["the submission handler", POST_ROUTE],
      ["the retention sweep", SWEEP],
      ["the administrator's re-send", ACTIONS],
    ] as const) {
      assert.match(quelle, /bestaetigungsLink\(/, `${wer} no longer mints its link through the one helper`);
      assert.doesNotMatch(quelle, /\/bestaetigung\?/, `${wer} spells a link of its own beside the helper`);
    }

    assert.doesNotMatch(POST_ROUTE, /console\.|logger\./, "the handler writes a line of its own, which the raw token could reach");
  });

  /* The panel and the messages state the same fan-out: told one seat was written to, the submitter
     chases nobody, and the two unopened links delete the application on the deadline. Every seat's
     label is read off `BEWERBUNG_SEATS`. */
  /* Read rather than rendered: the receipt replaces the form only after a submit has answered, which
     is a state transition and not a prop. */
  it("names the link every contact person holds, and singles out no seat", () => {
    const [, panel = ""] = FORM.split("Deine Bewerbung ist eingegangen");
    // The rendered copy alone: the comment above the paragraph discusses the wording this reads.
    const roh = panel.slice(panel.indexOf('<p className="muted-hint'));
    // Joined the way JSX joins a wrapped text node, so a sentence broken over two source lines is
    // read as the one sentence a reader meets.
    const absatz = roh
      .slice(roh.indexOf(">") + 1, roh.indexOf("</p>"))
      .replace(/\s+/g, " ")
      .trim();
    const satz = absatz.split(".").find((teil) => teil.includes("Link")) ?? "";

    assert.ok(satz !== "", "the panel names no confirmation link at all");
    assert.match(satz, /[Jj]ede Kontaktperson/, "the link sentence no longer says every contact person was written to");
    assert.match(satz, /eigenen Link/, "the link sentence no longer says the link is that person's own");

    for (const { label } of BEWERBUNG_SEATS) {
      assert.ok(!absatz.includes(label), `the panel singles out ${label} where every seat holds a link`);
    }

    // „eingegangen“ is not „vollständig“: an applicant told otherwise stops chasing the two people
    // the application is still waiting for.
    assert.match(absatz, /[Vv]ollständig[^.]*sobald alle drei bestätigt haben/, "the panel never says what makes the application complete");
    assert.doesNotMatch(absatz, /nichts weiter tun/, "the panel calls the workflow finished while three links are open");

    // The clock the sweep deletes on, read off the constant: a number typed here outlives a changed
    // bound, and no digit belongs in the copy for any other purpose.
    assert.ok(absatz.includes("{String(BEWERBUNG_BESTAETIGUNG_FRIST_TAGE)}"), "the panel states a deadline it did not read off the bound");
    assert.doesNotMatch(absatz, /\d/, "the panel types a number where the constant states the clock");

    // The decision DOES reach all three, and the panel has to say so or the applicant waits on nothing.
    assert.match(absatz, /alle[nr]? drei Kontaktpersonen/, "the panel never says the decision reaches all three");
  });
});

/*
 Both spines are read rather than rendered: what is asserted is a route handler's control flow, and
 a handler answers a request rather than rendering anything at all.
*/
describe("what stands in for a session on the session-less routes", () => {
  /** Both spines, because the guard is identical and one of the two being pinned is how this got here.
      Every site carrying that guard is `fl_frontend/src/core/requestSpines.test.ts`'s population. */
  const SPINES = [
    ["the public spine", PUBLIC_ROUTE],
    ["the undo spine", UNDO_ROUTE],
  ] as const;

  /* The guard compared WHOLE, not searched: every weakening leaves the words a search looks for
     standing. A deleted `return` is invisible to `tsc` and to ESLint at --max-warnings 0, a bare
     call being a side effect. */
  it("returns the refusal from the guard, on exactly the condition it declares", () => {
    for (const [name, source] of SPINES) {
      const kopf = 'const secFetchSite = request.headers.get("sec-fetch-site");';
      const ab = source.slice(source.indexOf(kopf) + kopf.length);
      const bedingung = ab.slice(ab.indexOf("if (") + "if (".length, ab.indexOf(") {"));
      // Cut at the statement's own semicolon: the first `}` after the brace belongs to the object
      // literal inside the call, not to the block.
      const rumpf = ab.slice(ab.indexOf(") {") + ") {".length, ab.indexOf(";", ab.indexOf(") {")) + 1);

      assert.ok(source.includes(kopf), `${name} no longer reads Sec-Fetch-Site`);
      // `null` passes deliberately: a browser too old to send it is still a reader of this page.
      assert.equal(bedingung, 'secFetchSite !== null && secFetchSite !== "same-origin"', `${name}'s condition was widened or made conditional`);
      // RETURNED, not merely constructed: dropped, the response is discarded and the write runs on.
      assert.equal(
        rumpf.trim(),
        "return NextResponse.json({ success: false, error: FREMDE_HERKUNFT });",
        `${name} builds a refusal it does not return, or answers with something else`,
      );
    }
  });

  /* 200 with the outcome in the body, as each spine's own closing comment requires: every caller
     throws on a non-2xx and reports the throw as a connection fault, so a status here sends a
     reader to check a network that is fine. */
  it("answers the refusal in German the caller actually renders", () => {
    for (const [name, source] of SPINES) {
      assert.doesNotMatch(source, /status: 403/, `${name} answers a status no caller reads past`);
      assert.doesNotMatch(source, /"Access Denied"/, `${name} still carries the English nothing renders`);
      assert.match(source, /const FREMDE_HERKUNFT =/, `${name} names no sentence for a cross-site caller`);
      assert.match(source, /kam nicht von dieser Seite/, `${name} no longer says where the request came from`);
      assert.doesNotMatch(source, /Verbindung/, `${name} sends a cross-site caller to check their connection`);
    }

    // The admin's own half: the undo did not happen and the change stands.
    assert.match(UNDO_ROUTE, /Die Änderung steht weiterhin\./, "the undo refusal stopped saying the change still stands");
  });

  /* Ordering read off the source, not off two `indexOf` positions a moved guard leaves unchanged:
     what makes this a guard is that nothing runs behind it. */
  it("seats the guard ahead of every statement that does work", () => {
    for (const [name, source] of SPINES) {
      const rumpf = source.slice(source.indexOf("): Promise<NextResponse> {"));
      const vorWache = rumpf.slice(0, rumpf.indexOf("const secFetchSite"));

      assert.doesNotMatch(vorWache, /\bawait\b|\brun\(\)|runWithIncomingCorrelationId/, `${name} works before the guard decides`);
    }
  });

  /* The undo spine's own authorization. The backend still refuses without it — `getAdminSession` sets
     the actor `apiClient` sends — but that is a DIFFERENT service, and `proxy.ts` matches
     `/admin/:path*`, never `/api/admin/*`. */
  it("checks the session before the undo restores anything", () => {
    const wache = "if (!(await getAdminSession())) {";

    assert.ok(UNDO_ROUTE.includes(wache), "the undo spine restores without checking who is asking");
    /* FIRST in the callback, not merely before the restore: anything above it is work done for a
       caller nobody has authorized, and „before the restore“ is satisfied by a check that has already
       parsed their body. */
    const auftakt = "const result = await runAdminMutation(route.mutationName, async () => {";
    const danach = UNDO_ROUTE.slice(UNDO_ROUTE.indexOf(auftakt) + auftakt.length).trimStart();

    assert.ok(danach.startsWith(wache), "something runs for an unauthorized caller before the session is checked");
    assert.match(
      UNDO_ROUTE.slice(UNDO_ROUTE.indexOf(wache)),
      /^if \(!\(await getAdminSession\(\)\)\) \{\s*return \{ success: false as const, error: ADMIN_FORBIDDEN \};/,
      "the session check falls through instead of refusing",
    );
  });

  /* `runAdminMutation`'s name says a session was checked. A public route reaching for it would read
     as authorized by something, and nothing here authorizes anything. */
  it("does not borrow the admin spine", () => {
    assert.doesNotMatch(POST_ROUTE, /runAdminMutation/, "a session-less route runs through the admin mutation spine");
    assert.match(POST_ROUTE, /handlePublicRequest\(request, \{/, "the route no longer runs through the public spine");
  });
});

describe("how the form asks for a wished opponent", () => {
  const WUNSCH = "Schule ohne Eintrag in der Liga";

  const WUNSCHGEGNER = renderMarkup(FormTeamSection, {
    trikot: { vorhandener_satz: "", wunschfarbe: null },
    kader: { voraussichtliche_groesse: null, gute_spieler: null },
    wunschgegner: WUNSCH,
    schulen: SCHULEN,
    vergebeneFarben: [],
    onTrikotChange: () => undefined,
    onKaderChange: () => undefined,
    onWunschgegnerChange: () => undefined,
    onFieldLeft: () => undefined,
    onFarbePicked: () => undefined,
  });

  /** The one element the submitted payload is read off, whatever HeroUI renders around it. */
  const traeger = /<(\w+)([^>]*\bname="wunschgegner"[^>]*)>/.exec(WUNSCHGEGNER);

  /* First: a control the section never rendered would leave every case below reading `null`, and the
     ones asking what it is NOT would pass over that. */
  it("renders the control, under a label naming the wish", () => {
    assert.notEqual(traeger, null, "the team section renders nothing carrying the payload's own field name");
    assert.match(WUNSCHGEGNER, /<label[^>]*>Wunschgegner[^<]*<\/label>/, "the control carries no label naming the wish");
  });

  /* Read off `FIELD_LABEL` rather than spelled here: a hand-typed size or weight drifts from the
     labels above it on the same panel, and the case above passes on the words alone. */
  it("dresses that label in the shared field-label style", () => {
    const etikett = /<label ([^>]*)>Wunschgegner[^<]*<\/label>/.exec(WUNSCHGEGNER)?.[1] ?? "";
    const klassen = (/class="([^"]*)"/.exec(etikett)?.[1] ?? "").split(" ");

    assert.notEqual(etikett, "", "the wish's label moved, so the loop below reads nothing");
    for (const klasse of FIELD_LABEL.split(" ")) assert.ok(klassen.includes(klasse), `the wish's label lost FIELD_LABEL's ${klasse}`);
  });

  /* The whole reason this is not a picker. A closed set moves the payload name onto a hidden input
     carrying the SELECTED KEY, so a school not already in the league submits an empty wish. */
  it("submits the typed name, which a closed set would drop", () => {
    const freitext = renderTree(
      h(
        ComboBox,
        { allowsCustomValue: true, name: "probe", inputValue: WUNSCH },
        h(Label, null, "Probe"),
        h(ComboBox.InputGroup, null, h(Input, null), h(ComboBox.Trigger, null)),
      ),
    );
    const geschlossen = renderTree(
      h(
        ComboBox,
        { name: "probe", inputValue: WUNSCH },
        h(Label, null, "Probe"),
        h(ComboBox.InputGroup, null, h(Input, null), h(ComboBox.Trigger, null)),
      ),
    );

    const nameTraeger = (html: string) => /<input([^>]*\bname="probe"[^>]*)>/.exec(html)?.[1] ?? "";
    assert.match(nameTraeger(freitext), /role="combobox"/, "the control this case compares against changed shape");
    assert.match(nameTraeger(geschlossen), /type="hidden"/, "a closed set now submits the typed text too, so this proves nothing");

    assert.match(traeger?.[2] ?? "", /role="combobox"/, "the wished opponent became a picker over the league's own clubs");
    assert.match(traeger?.[2] ?? "", new RegExp(`value="${WUNSCH}"`), "the box submits something other than what was typed into it");
  });

  /* `name` IS the payload path: `<Form validationErrors>` distributes by it, so a refusal reaches
     this box only under the name the schema spells. */
  it("names the field as the payload spells it", () => {
    assert.equal(traeger?.[1], "input", "the payload's field name sits on something other than the text box");
  });

  /* A TYPED field is judged when it is LEFT: moved onto the change handler, the form would grade a
     name between two keystrokes. A handler binding reaches no markup, so this is read. */
  it("judges it on blur rather than between keystrokes", () => {
    const gegner = /<ComboBox([\s\S]*?)<Label/.exec(TEAM_SECTION)?.[1] ?? "";

    assert.notEqual(gegner, "", "the wish control moved, so the two assertions below read nothing");
    assert.match(gegner, /onBlur=\{\(\) => onFieldLeft\(\["wunschgegner"\]\)\}/, "the wish is no longer judged when the field is left");
    assert.doesNotMatch(gegner, /onInputChange=\{[^}]*onFieldLeft/, "the wish is judged between two keystrokes");
  });

  /* The league's whole roster and never a season-scoped set: one growing with each acceptance would
     hand a late applicant the longer list. A closed popover renders no item, so the wiring is read. */
  it("suggests the league's clubs, the same list the school picker reads", () => {
    assert.match(
      FORM,
      /<FormTeamSection[\s\S]*?schulen=\{schulen\}/,
      "the suggestions no longer come from the club list the page already read",
    );
    assert.match(TEAM_SECTION, /\{schulen\.map\(/, "the team section offers no suggestions at all");
    // The list does reach the page: the school picker renders its rows, and both read one prop.
    for (const { name } of SCHULEN) assert.ok(LAEUFT.includes(name), `the page offers no row for ${name}`);
  });
});

describe("which kit colours the wish picker leaves out", () => {
  const VERGEBEN = ["rot", "blau"] as const;

  /** The wish picker's own options, read where the submitted value comes from. */
  function angeboteneFarben(html: string): string[] {
    const select = /<select[^>]*\bname="trikot\.wunschfarbe"[^>]*>([\s\S]*?)<\/select>/.exec(html)?.[1] ?? "";

    return [...select.matchAll(/<option value="([^"]+)"/g)].map((treffer) => treffer[1] ?? "");
  }

  /* Three hops — page to view, view to form, form to picker — each droppable on its own, and each
     leaving the picker offering the whole palette with every gate green. */
  it("carries the assignments from the view down into the picker's own options", () => {
    const html = renderMarkup(BewerbungView, { ...ANSICHT, fenster: FENSTER, vergebeneFarben: VERGEBEN });
    const alle = TRIKOT_FARBE_OPTIONS.map((option) => option.value);

    assert.ok(alle.length > VERGEBEN.length, "the palette is no bigger than the assigned set, so this case compares nothing");
    assert.deepEqual(
      angeboteneFarben(html),
      alle.filter((farbe) => !VERGEBEN.includes(farbe as (typeof VERGEBEN)[number])),
      "the picker offers a colour the season has assigned, or drops one it has not",
    );
  });

  /* The whole palette while nothing is assigned, which is what a dropped prop looks like — so the
     case above only means something beside this one. */
  it("offers the whole palette where the season has assigned nothing", () => {
    assert.deepEqual(
      angeboteneFarben(LAEUFT),
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
    const zweig = PAGE.slice(PAGE.indexOf("await getBewerbungTrikotfarben"));

    assert.notEqual(zweig, "", "the page no longer awaits the read this assertion is about");
    assert.match(zweig.slice(0, zweig.indexOf(";")), /\(\) => \[\]/, "an unreadable answer no longer offers the whole palette");
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

  const gestempelt = (schluessel: Absatz): string => fuelleFassung(BESTAETIGUNG_ABSAETZE[schluessel], SLOTS);

  /** Every paragraph and list item a render puts on the page, as a reader reads it. */
  const absaetzeVon = (html: string): string[] =>
    [...html.matchAll(/<(p|li)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((treffer) => textOf(treffer[2] ?? "").trim());

  /* The four components carrying the standing text, the armed decline's own paragraph among them:
     rendered from the form panel it appears only after a press, which no static render reaches. */
  const HINWEISE = [
    renderMarkup(BestaetigungHinweise, { schule: SLOTS.schule, saison: SLOTS.saison, rolle: SLOTS.rolle, ablehnenLabel: ABLEHNEN_LABEL }),
    renderMarkup(WhatsappHinweis, {}),
    renderMarkup(KlickBestaetigung, { id: "klick-punkte", vorname: SLOTS.vorname, schule: SLOTS.schule, rolle: SLOTS.rolle }),
    renderMarkup(WiderspruchFolge, {}),
  ].join("");

  const FORMULAR = renderMarkup(BestaetigungFormPanel, {
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
    const version = new Set((Object.keys(BESTAETIGUNG_ABSAETZE) as Absatz[]).map(gestempelt));
    const gerendert = absaetzeVon(HINWEISE);

    assert.ok(gerendert.length > 0, "the information text rendered nothing, so this case compares nothing");
    for (const absatz of gerendert) assert.ok(version.has(absatz), `the page renders a paragraph the stamp does not cover: ${absatz}`);
  });

  /* The other direction, which the case above cannot see: a paragraph nothing renders leaves the
     record citing more than its reader read. */
  it("renders every paragraph the version holds", () => {
    const gerendert = new Set(absaetzeVon(HINWEISE));

    for (const schluessel of Object.keys(BESTAETIGUNG_ABSAETZE) as Absatz[]) {
      assert.ok(gerendert.has(gestempelt(schluessel)), `the version holds ${schluessel}, which the page renders nowhere`);
    }
  });

  /* The switch is the one thing consented to rather than confirmed, and the button describes itself
     by the stamped points rather than a summary beside them, which read as a second promise. */
  it("takes the switch's label off that same version, and points the button at the stamped four", () => {
    const text = textOf(FORMULAR);
    const beschrieben = [...FORMULAR.matchAll(/aria-describedby="([^"]*)"/g)].flatMap((treffer) => (treffer[1] ?? "").split(" "));

    assert.ok(text.includes(BESTAETIGUNG_EINWILLIGUNG.schalter), "the switch says something the stamped version does not hold");
    assert.ok(beschrieben.length > 0, "no control on the form describes itself by anything at all");
    assert.ok(
      // Cut at the first close, which is this block's: the four points stand in a list, and no
      // element between the id and them opens a `div` of its own.
      beschrieben.some((id) => {
        const anfang = FORMULAR.indexOf(`id="${id}"`);

        return anfang !== -1 && FORMULAR.slice(anfang).split("</div>")[0]?.includes(gestempelt("klickIdentitaet")) === true;
      }),
      "no described element holds the stamped points, so the button promises something written nowhere",
    );
  });

  /* A stamped sentence copied into the panel's own prose leaves two wordings of one paragraph free
     to drift apart, and a paragraph rendered nowhere leaves the record citing more than its reader
     read. */
  it("puts each stamped paragraph on the page exactly once", () => {
    const version = new Map((Object.keys(BESTAETIGUNG_ABSAETZE) as Absatz[]).map((schluessel) => [gestempelt(schluessel), schluessel]));
    const gezaehlt = new Map<Absatz, number>();

    for (const absatz of absaetzeVon(FORMULAR)) {
      const schluessel = version.get(absatz);
      if (schluessel !== undefined) gezaehlt.set(schluessel, (gezaehlt.get(schluessel) ?? 0) + 1);
    }

    // Every key but the armed decline's, which no static render reaches: the press that reveals it
    // is what this render does not make.
    const erwartet = (Object.keys(BESTAETIGUNG_ABSAETZE) as Absatz[]).filter((schluessel) => schluessel !== "ablehnenFolge");

    assert.deepEqual([...gezaehlt.keys()].sort(), [...erwartet].sort(), "the form renders a stamped paragraph twice over, or drops one");
    for (const [schluessel, anzahl] of gezaehlt) assert.equal(anzahl, 1, `${schluessel} stands on the page ${String(anzahl)} times`);
  });
});

describe("how wide the confirmation page stands, and how many boxes it draws", () => {
  const GEOEFFNET = {
    acknowledged: 1,
    zustand: "gueltig",
    saison_id: "2026",
    schule: "Lessing-Kolleg",
    rolle: "ansprechperson",
    vorname: "Mira",
    text_version: BESTAETIGUNG_EINWILLIGUNG.textVersion,
  } as const;

  /** The reader's own facts, each distinctive enough that finding one in the markup means this reader. */
  const EIGENE_WERTE = ["Mira", "Lessing-Kolleg", "2026", "Ansprechperson"];

  const SLOTS = {
    schule: GEOEFFNET.schule,
    saison: GEOEFFNET.saison_id,
    rolle: "Ansprechperson",
    vorname: GEOEFFNET.vorname,
    ablehnen: ABLEHNEN_LABEL,
    minAlter: String(BEWERBUNG_MIN_ALTER),
    kontakt: KONTAKT_EMAIL,
    datenschutz: "Datenschutzerklärung",
  };
  const GESTEMPELT = new Set(Object.values(BESTAETIGUNG_ABSAETZE).map((text) => fuelleFassung(text, SLOTS)));

  const GUELTIG = renderMarkup(BestaetigungView, { start: { zustand: "gueltig", ansicht: GEOEFFNET, token: "kein-echtes-token" } });
  const ZUSTAND_SEITEN = (["bestaetigt", "abgelehnt", "abgelaufen", "ungueltig", "unlesbar"] as const).map((zustand) => ({
    zustand: zustand,
    html: renderMarkup(BestaetigungView, { start: { zustand: zustand } }),
  }));

  /** A box a reader sees as one: the radius every panel recipe on this page carries, over a border. */
  const istFlaeche = (klassen: string): boolean => /(^| )rounded-2xl( |$)/.test(klassen) && /(^| )border( |$)/.test(klassen);

  const LEERE_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

  /** How many of those boxes stand inside one another at the deepest point of one render. */
  function flaechenTiefe(html: string): number {
    const offen: boolean[] = [];
    let tiefe = 0;
    let tiefste = 0;

    for (const treffer of html.matchAll(/<(\/?)([a-zA-Z][^\s/>]*)([^>]*)>/g)) {
      const [, schraeg = "", tag = "", rest = ""] = treffer;

      if (schraeg === "/") {
        if (offen.pop() === true) tiefe -= 1;
        continue;
      }
      if (LEERE_TAGS.has(tag.toLowerCase()) || rest.trimEnd().endsWith("/")) continue;

      const flaeche = istFlaeche(/class="([^"]*)"/.exec(rest)?.[1] ?? "");

      offen.push(flaeche);
      if (flaeche) tiefste = Math.max(tiefste, (tiefe += 1));
    }

    return tiefste;
  }

  /** What the page says in its own words: the passages it draws, less the ones the stamped version owns. */
  function eigenePassagen(html: string): string[] {
    const gezogen = [...html.matchAll(/<(p|li|dd|h1|h2|h3|button|a)\b[^>]*>([\s\S]*?)<\/\1>/g)].map((treffer) => treffer[2] ?? "");

    return gezogen.filter((passage) => !GESTEMPELT.has(textOf(passage).trim()));
  }

  const ohneHervorhebung = (passage: string): string => passage.replace(/<strong class="text-foreground font-bold">[\s\S]*?<\/strong>/g, "");

  /* The application form's page, not a card of its own: one column measures the same on both ends of
     the workflow, and a cap typed here is one nobody moves when that page's moves. */
  it("stands in the column the application page stands in", () => {
    assert.match(wurzelKlasse(LAEUFT), /max-w-meta/, "the application page no longer names the width this case compares against");
    assert.equal(wurzelKlasse(GUELTIG), wurzelKlasse(LAEUFT), "the confirmation page draws its own column rather than the shared one");
  });

  /* Nested boxes are what a phone pays for twice: each one spends the gutter again, and the words
     inside the innermost get what is left. */
  it("draws no panel inside a panel, in any state", () => {
    assert.equal(flaechenTiefe(GUELTIG), 1, "the form's page draws no panel at all, or draws one inside another");

    for (const { zustand, html } of ZUSTAND_SEITEN) {
      assert.equal(flaechenTiefe(html), 1, `${zustand} draws no panel at all, or draws one inside another`);
    }
  });

  /* The emails set a reader's own name in bold, and a page that leaves it in the run of the sentence
     reads as a form letter. Never in the stamped paragraphs, which are the stored text unmarked. */
  it("gives every value of the reader's own the page's one emphasis", () => {
    const passagen = eigenePassagen(GUELTIG);

    assert.ok(passagen.length > 0, "the page renders no words of its own, so this case compares nothing");
    assert.ok(
      passagen.some((passage) => EIGENE_WERTE.some((wert) => textOf(passage).includes(wert))),
      "no passage of the page's own names this reader at all",
    );

    for (const passage of passagen) {
      const nackt = textOf(ohneHervorhebung(passage));

      for (const wert of EIGENE_WERTE) {
        assert.ok(!nackt.includes(wert), `„${wert}“ stands in the page's own prose with nothing making it stand out: ${textOf(passage)}`);
      }
    }
  });

  /* One word for what a contact does to their own entry, the league's own „Absage“ being the other
     decision entirely. The stamped paragraphs keep their wording and are read past here. */
  it("calls a contact's refusal a Widerspruch wherever it names the act", () => {
    assert.match(WIDERSPRUCH_SENDEN, /Widerspruch/, "the armed press no longer sends what the page calls it");

    for (const { zustand, html } of [{ zustand: "gueltig", html: GUELTIG }, ...ZUSTAND_SEITEN]) {
      for (const passage of eigenePassagen(html)) {
        assert.doesNotMatch(textOf(passage), /ablehn/i, `${zustand} calls the act by the retired word: ${textOf(passage)}`);
      }
    }
  });
});

describe("how the confirmation page banners the facts a reader arrived with", () => {
  const ZEILEN = [
    { label: "Schule", wert: "Gymnasium an einer sehr langen Straße im Frankfurter Norden" },
    { label: "Saison", wert: "2026" },
    { label: "Deine Rolle", wert: "Ansprechperson" },
  ];
  const BANNER = renderMarkup(FaktenBanner, { zeilen: ZEILEN });

  /* The mails panel these same facts in a row, and a page that stacks them on a phone spends its
     whole first screen on three facts the reader already met in the mail. */
  it("keeps every fact on one row, at every width", () => {
    const wurzel = /class="([^"]*)"/.exec(BANNER)?.[1] ?? "";

    assert.match(wurzel, /(^| )flex-row( |$)/, "the banner is not a row to begin with");
    assert.doesNotMatch(wurzel, /flex-wrap|flex-col|grid/, "the banner may break out of one row");
    assert.doesNotMatch(BANNER, /:flex-col|:flex-wrap|:grid/, "the banner takes another shape at some width");
  });

  /* A row that never wraps has one way left to fail: a school name pushing the season off the
     screen. The ellipsis is what stops it, and `title` is where the whole name is then read. */
  it("truncates every value and keeps the whole of it in reach", () => {
    const werte = [...BANNER.matchAll(/<dd([^>]*)>/g)].map((treffer) => treffer[1] ?? "");

    assert.equal(werte.length, ZEILEN.length, "the banner rendered a different number of values than it was handed");
    for (const [index, attribute] of werte.entries()) {
      assert.match(attribute, /(^|\s|")truncate(\s|")/, `value ${String(index)} carries no truncation`);
      assert.ok(attribute.includes(`title="${ZEILEN[index]?.wert ?? ""}"`), `value ${String(index)} keeps its whole text nowhere`);
    }
  });
});

describe("what arming the objection is allowed to move on the confirmation page", () => {
  const angaben = (isDisabled: boolean): string =>
    renderMarkup(BestaetigungAngaben, {
      entwurf: { geburtsdatum: "", whatsapp: false },
      onEntwurf: () => undefined,
      onGeburtsdatumVerlassen: () => undefined,
      isDisabled: isDisabled,
      hinweisId: "geburtsdatum-hinweis",
    });

  const entscheidung = (isConfirming: boolean): string =>
    renderMarkup(BestaetigungEntscheidung, {
      isConfirming: isConfirming,
      isPending: false,
      isDeclining: false,
      beschreibtId: "klick-punkte",
      onWiderspruch: () => undefined,
      onCancel: () => undefined,
    });

  // Deduplicated: the date picker publishes its name on both the group it submits from and the
  // field a browser autofills into, and neither is a second thing being asked for.
  const feldNamen = (html: string): string[] => [...new Set([...html.matchAll(/\sname="([^"]*)"/g)].map((treffer) => treffer[1] ?? ""))].sort();
  const knopfZahl = (html: string): number => [...html.matchAll(/<button\b/g)].length;

  /* Withdrawing the two controls is what walked the button row up the page under the pointer that
     had just armed it; disabled, they hold their place and still say the objection wants neither. */
  it("asks for the same fields armed as unarmed", () => {
    assert.deepEqual(feldNamen(angaben(false)), [...BESTAETIGUNG_FELDER].sort(), "the form renders a control for another set of paths");
    assert.deepEqual(feldNamen(angaben(true)), feldNamen(angaben(false)), "arming the objection takes a field off the page");
  });

  /* The cancel takes the objection's slot rather than joining it: a third control appearing in the
     row moves the press the reader is aiming at. */
  it("leaves the row the same number of buttons to seat", () => {
    assert.equal(knopfZahl(entscheidung(false)), 2, "the unarmed row offers something other than the two presses");
    assert.equal(
      knopfZahl(entscheidung(true)),
      knopfZahl(entscheidung(false)),
      "arming the objection changes how many buttons stand in the row",
    );
  });
});

describe("where the confirmation page shows a refusal it cannot put at a field", () => {
  const FORMULAR = renderMarkup(BestaetigungFormPanel, {
    token: "kein-echtes-token",
    vorname: "Mira",
    schule: "Lessing-Kolleg",
    saison: "2026",
    rolle: "Ansprechperson",
    onAbschluss: () => undefined,
  });

  /* This set decides whether a refusal is shown at all: drifted one way, a live field's refusal
     raises a toast beside itself; drifted the other, a refusal on a path no control renders is shown
     nowhere. */
  it("names exactly the paths the form renders a control for", () => {
    const gerendert = [...new Set([...FORMULAR.matchAll(/\bname="([^"]+)"/g)].map((treffer) => treffer[1]))].sort();

    assert.ok(gerendert.length > 0, "the form rendered no named control at all, so this case compares nothing");
    assert.deepEqual(gerendert, [...BESTAETIGUNG_FELDER].sort(), "the form renders a control the set does not name, or the reverse");
  });

  /* Read rather than rendered: this is the branch a fetch answer takes, and the panel reaches it
     only after a request no render issues. */
  it("raises the danger toast whenever the refusal named no rendered path", () => {
    assert.match(
      CONFIRM_PANEL,
      /if \(!sprichtAmFeld\(antwort\.fieldErrors\)\) \{\s*appToast\.danger\(/,
      "the toast is gated on something other than whether a rendered field was named",
    );
    // The gate it replaced: any field error at all withheld the toast, so a refusal on `token`,
    // `antwort` or the stamped label showed the reader nothing.
    assert.doesNotMatch(CONFIRM_PANEL, /hasFieldErrors/, "the panel is back to withholding the toast on any field error");
  });
});

describe("where a link answered in another window lands", () => {
  const panelText = (zustand: LinkZustand): string => textOf(renderMarkup(BestaetigungView, { start: { zustand: zustand } }));

  /* The two answers have to read differently, which is the whole of what the second read buys: told
     „bestätigt“, a person who objected believes the entry they refused is standing. */
  it("gives a confirmed seat and one that was objected to different words", () => {
    const bestaetigt = panelText("bestaetigt");
    const widersprochen = panelText("abgelehnt");

    assert.notEqual(bestaetigt, widersprochen, "both answers render one panel, so the read has nothing to distinguish");
    assert.match(widersprochen, /widersprochen/, "the objected panel no longer says the entry was refused");
    assert.doesNotMatch(bestaetigt, /widersprochen/, "the confirmed panel talks about an objection");
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
     stated reason; a seat's refusal is `Ablehnung`, and the two read as different decisions. */
  it("sends the seat's own decline notice rather than the league's rejection", () => {
    assert.match(CONFIRM_ROUTE, /buildBewerbungAblehnungEmail/, "the decline no longer composes the message written for it");
    assert.doesNotMatch(CONFIRM_ROUTE, /buildBewerbungAbsageEmail/, "a seat's refusal is reported as the league turning the school down");
  });

  /* The one branch with nowhere to send: the seat that would have been addressed is the seat that
     just emptied itself, and any substitute recipient is a third party. */
  it("sends nothing where the Ansprechperson seat is empty, and logs neither address nor token", () => {
    const zweig = CONFIRM_ROUTE.slice(CONFIRM_ROUTE.indexOf("ansprechperson_email === null"));
    const bis = zweig.slice(0, zweig.indexOf("await sendBewerbungMail"));
    // The call's own arguments, which is what reaches the stream; the comment above it is prose.
    const zeile = /logger\.info\(([\s\S]*?)\);/.exec(bis)?.[1] ?? "";

    assert.notEqual(zweig, "", "the handler no longer answers an empty Ansprechperson seat at all");
    assert.match(bis, /return;/, "the empty branch falls through into the send");
    assert.notEqual(zeile, "", "the empty seat passes without a line saying the message went nowhere");
    assert.doesNotMatch(zeile, /ansprechperson_email|token|vorname/, "the line carries an address, a token or a person");
  });

  /* The label names which words the confirming person read, so a body's own value is a claim no
     browser may make: a caller could otherwise file a record under a retired wording, or one
     nobody ever wrote. */
  it("stamps the registry's own label over whatever label the body carried", () => {
    const fremd = {
      token: "kein-echtes-token",
      antwort: "erteilt",
      geburtsdatum: "1984-05-09",
      whatsapp: false,
      text_version: "2019-01-erfunden",
    };
    // The handler's own two steps, in its order: the stamp rewrites the body, and the schema judges
    // what the stamp produced.
    const gestempelt = FLBewerbungEinwilligungAntwortPayloadSchema.parse(stampEinwilligungFassung(fremd));

    assert.equal(gestempelt.text_version, BESTAETIGUNG_EINWILLIGUNG.textVersion);
    assert.match(CONFIRM_ROUTE, /stampEinwilligungFassung\(body\)/, "the browser's own label reaches the endpoint");
    assert.doesNotMatch(CONFIRM_ROUTE, /safeParse\(body\)/, "the body is judged before its label is replaced");
  });

  /* Judged first, a body carrying no label is refused on `text_version` — a path no control renders,
     so the refusal reaches the reader as nothing at all. */
  it("admits a body that names no label, the stamp having written one", () => {
    const ohneFassung = { token: "kein-echtes-token", antwort: "erteilt", geburtsdatum: "1984-05-09", whatsapp: false };

    assert.equal(
      FLBewerbungEinwilligungAntwortPayloadSchema.safeParse(ohneFassung).success,
      false,
      "the label is optional, so the stamp's position decides nothing",
    );
    assert.equal(FLBewerbungEinwilligungAntwortPayloadSchema.safeParse(stampEinwilligungFassung(ohneFassung)).success, true);
  });

  /* The switch is hidden while a decline is armed, so a `true` here is a drifted client rather than
     a press: taken, the echo would report a scope the emptied slot records nowhere. */
  it("refuses a decline that carries the WhatsApp consent, at the shape both tiers judge", () => {
    const abgelehnt = {
      token: "kein-echtes-token",
      antwort: "abgelehnt",
      geburtsdatum: null,
      text_version: BESTAETIGUNG_EINWILLIGUNG.textVersion,
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
    const antwort = /return \{ success: true as const,([^}]*)\}/.exec(CONFIRM_ROUTE)?.[1] ?? "";

    assert.notEqual(antwort, "", "the success answer is no longer a literal this can read");
    assert.deepEqual(
      [...antwort.matchAll(/(\w+):/g)].map((treffer) => treffer[1]),
      ["ergebnis", "geburtsdatum", "whatsapp"],
      "the browser is answered something other than the seat's own three fields",
    );
    assert.doesNotMatch(antwort, /\.\.\./, "the answer spreads the response, so every server-only field travels with it");
  });
});
