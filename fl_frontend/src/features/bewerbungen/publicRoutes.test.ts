import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { BEWERBUNG_SEATS } from "./constants.ts";

const FRONTEND_DIR = path.resolve(import.meta.dirname, "..", "..", "..");
const SRC_DIR = path.join(FRONTEND_DIR, "src");
const APP_DIR = path.join(SRC_DIR, "app");
const ROUTE_DIR = path.join(APP_DIR, "(public)", "bewerbung", "[saison_id]");

const LANDING = readFileSync(path.join(APP_DIR, "(public)", "page.tsx"), "utf8");
const PAGE = readFileSync(path.join(ROUTE_DIR, "page.tsx"), "utf8");
const LOADING = readFileSync(path.join(ROUTE_DIR, "loading.tsx"), "utf8");
const VIEW = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "views", "BewerbungView.tsx"), "utf8");
const NEXT_CONFIG = readFileSync(path.join(FRONTEND_DIR, "next.config.ts"), "utf8");
const BAND = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "ui", "BewerbungOffenBand.tsx"), "utf8");
const SKELETON = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "ui", "BewerbungBandSkeleton.tsx"), "utf8");
const KONTAKT_PAGE = readFileSync(path.join(APP_DIR, "(public)", "(meta)", "kontakt", "page.tsx"), "utf8");
const KONTAKT_VIEW = readFileSync(path.join(SRC_DIR, "features", "meta", "components", "views", "KontaktView.tsx"), "utf8");
const POST_ROUTE = readFileSync(path.join(APP_DIR, "api", "bewerbung", "route.ts"), "utf8");
const PUBLIC_ROUTE = readFileSync(path.join(SRC_DIR, "shared", "utils", "publicRoute.ts"), "utf8");
const UNDO_ROUTE = readFileSync(path.join(SRC_DIR, "shared", "utils", "undoRoute.ts"), "utf8");
const FORM = readFileSync(path.join(SRC_DIR, "features", "bewerbungen", "components", "forms", "BewerbungForm", "BewerbungForm.tsx"), "utf8");

/**
 * The `saison` slot per ground, each cut out so an assertion reads that arm and nothing near it. The BASE is
 * shared, so a colour there reaches both pages; only the landing arm may name one.
 */
const BASE_SAISON = /saison: "([^"]*)"/.exec(BAND)?.[1] ?? "";
const SURFACE_SAISON = /surface: \{[^}]*saison: "([^"]*)"/.exec(BAND)?.[1] ?? "";
const FIELD_ARM = /field: \{([^}]*)\}/.exec(BAND)?.[1] ?? "";
const FIELD_SAISON = /saison: "([^"]*)"/.exec(FIELD_ARM)?.[1] ?? "";

/** The header's own list, cut out first: every other `href` in that file belongs to another control. */
const KOPF_LINKS = /const KOPF_LINKS = \[([\s\S]*?)\] as const;/.exec(VIEW)?.[1] ?? "";

/** Every `href="/..."` the application page's header offers, in the order it offers them. */
const KOPF_HREFS = [...KOPF_LINKS.matchAll(/href: "(\/[^"]*)"/g)].map((treffer) => treffer[1]!);

/** The label each of those wears, read off the same list so the two stay in step. */
const KOPF_LABELS = new Map([...KOPF_LINKS.matchAll(/href: "(\/[^"]*)", label: "([^"]+)"/g)].map((t) => [t[1]!, t[2]!]));

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

describe("the links the application page's header offers", () => {
  /* A header offering nothing is the failure the assertions below cannot see: they would all pass
     over an empty list. */
  it("finds all three of them", () => {
    assert.deepEqual(KOPF_HREFS, ["/about", "/kontakt", "/dashboard"], "the header no longer offers About, Kontakt and the dashboard");
  });

  /* A dead one costs nothing at build time and 404s the one visitor this page exists for. */
  for (const href of ["/about", "/kontakt", "/dashboard"]) {
    it(`lands somewhere for ${href}`, () => {
      assert.ok(isRouteAnswered(href), `${href} has neither a page nor a redirect`);
    });
  }

  /* `?saison_id=` here would pin the link to the season being APPLIED for, which is a future one the
     dashboard withholds. Bare, the redirect resolves the running season instead. */
  it("leaves the dashboard link unparameterised", () => {
    assert.ok(!VIEW.includes("/dashboard?"), "the dashboard link carries a season the dashboard cannot show");
  });

  /* Which is exactly why the label may not be the nav's generic one: the banner above these links
     states the season being applied for, and this link goes to a different one. A reader who learns
     that only after the click learnt it too late. */
  it("names the season the dashboard link actually reaches", () => {
    assert.match(KOPF_LABELS.get("/dashboard") ?? "", /[Ll]aufende/, "the dashboard link no longer says which season it opens");
  });
});

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
    const fallback = /fallback=\{([\s\S]*?)\}>\s*<BewerbungOffenBand/.exec(LANDING)?.[1] ?? "";

    assert.match(fallback, /<BewerbungBandSkeleton \/>/, "the band slot falls back to something other than its skeleton");
    assert.doesNotMatch(fallback, /Deine Schule|Du hast Fragen/, "the fallback shows words it may have to swap for different ones");
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
    assert.match(KONTAKT_PAGE, /<Suspense fallback=\{null\}>/, "the contact page's slot reserves space its band may not fill");
  });
});

describe("what the application page holds while it loads", () => {
  /* Both states fill the VIEWPORT, or the one that does not leaves the site footer on screen for the
     length of the read — `fills` defaults to `region`, so dropping it fails silently. */
  it("fills the viewport on a navigation and on a stream", () => {
    assert.match(LOADING, /<ContentLoader fills="viewport" \/>/, "the route's loading.tsx stops short of the footer");
    assert.match(PAGE, /fallback=\{<ContentLoader fills="viewport" \/>\}/, "the page's boundary stops short of the footer");
  });
});

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

describe("the three destinations the header offers", () => {
  /* Peers, not a ranked set: same treatment, one icon each so they are tellable apart at a glance.
     A link that lost either half reads as a different kind of control from the two beside it. */
  it("gives every link a reason above it and an icon inside it", () => {
    const eintraege = [...KOPF_LINKS.matchAll(/anlass: "([^"]+)", Icon: (\w+)/g)];
    assert.equal(eintraege.length, 3, "not every header link carries both a label and an icon");
    assert.equal(new Set(eintraege.map((e) => e[2])).size, 3, "two header links share an icon, so the pair cannot be told apart");
  });

  /* The outline treatment is what makes them equal. A `primary` among them would rank one above the
     other two, which is the hierarchy these three deliberately do not have. */
  it("keeps all three on the same treatment", () => {
    const nav = /<nav[\s\S]*?<\/nav>/.exec(VIEW)?.[0] ?? "";
    assert.ok(nav !== "", "the header renders no <nav> at all");
    assert.match(nav, /intent: "outline", size: "sm"/, "the header links no longer share the outline recipe");
    assert.doesNotMatch(nav, /"primary"/, "a header link was promoted above the other two");
  });
});

describe("where the contact page seats the application band", () => {
  /* Under the page's own heading and description, above everything else. The two halves drift apart
     on their own: the page can stop passing the slot, or the view can stop rendering it, and either
     leaves the band silently gone with every gate green. */
  it("passes the band into the view rather than rendering it beside", () => {
    assert.match(KONTAKT_PAGE, /bewerbungSlot=\{/, "the contact page no longer hands the band to the view");
    assert.match(KONTAKT_PAGE, /<BewerbungOffenBand[^>]*\/>/, "the contact page stopped rendering the band");
  });

  it("renders the slot between the description and the first separator", () => {
    const slot = KONTAKT_VIEW.indexOf("{bewerbungSlot}");
    const beschreibung = KONTAKT_VIEW.indexOf("offenes Ohr");
    const trenner = KONTAKT_VIEW.indexOf("soccer-field-separator");

    assert.ok(slot !== -1, "the view renders no band slot at all");
    assert.ok(slot > beschreibung, "the band sits above the heading and description");
    assert.ok(slot < trenner, "the band sits below the opening block instead of under the description");
  });
});

describe("what the page's header claims while no form is on it", () => {
  /* Five of the six window states render no form. The condition is compared WHOLE, not split on:
     `zustand === "laeuft" || zustand === "vorbei"` still contains the literal a split would find. */
  it("keeps the invitation on exactly the running state", () => {
    const [, kopf = ""] = VIEW.split("muted-hint max-w-xl");
    const [absatz = ""] = kopf.split("</p>");
    const bedingung = absatz.slice(absatz.indexOf("{zustand") + 1, absatz.indexOf("?")).trim();

    assert.equal(bedingung, 'zustand === "laeuft"', "the invitation renders in a state that shows no form");

    const [, arme = ""] = absatz.split("?");
    const [offen = "", geschlossen = ""] = arme.split(":");
    assert.match(offen, /Trag Dein Team hier ein/, "the invitation left the running arm");
    assert.doesNotMatch(geschlossen, /Trag Dein Team hier ein/, "the closed arm invites an application it cannot take");
  });
});

describe("who the submission's receipt is addressed to", () => {
  /* Which collector the route CALLS, the collectors themselves being pinned in `notifications.test.ts`.
     Swapped for the decision fan-out, the receipt reaches three addresses nobody has confirmed yet,
     and every test in this suite goes on passing. */
  it("collects the Ansprechperson's mailbox alone, never the decision fan-out", () => {
    assert.match(POST_ROUTE, /collectBewerbungEingangEmpfaenger\(parsed\.data\.kontakte\)/, "the receipt uses another collector");
    assert.doesNotMatch(POST_ROUTE, /collectBewerbungEmpfaenger\(/, "the receipt fans out the way a committed decision does");
  });

  /* The panel and the message state the same fan-out, or the two who got nothing read the silence
     as a failed submission and send a second application. Every OTHER seat is read off
     `BEWERBUNG_SEATS`. */
  it("names the receipt's one recipient in the panel, and no other seat", () => {
    const [, panel = ""] = FORM.split("Deine Bewerbung ist eingegangen");
    // The rendered copy alone: the comment above the paragraph discusses the wording this reads.
    const roh = panel.slice(panel.indexOf('<p className="muted-hint'));
    const absatz = roh.slice(roh.indexOf(">") + 1, roh.indexOf("</p>"));
    const satz = absatz.split(".").find((teil) => teil.includes("Bestätigung")) ?? "";

    assert.ok(satz !== "", "the panel names no receipt at all");
    assert.ok(satz.includes("Ansprechperson"), "the receipt sentence names no recipient");

    for (const { value, label } of BEWERBUNG_SEATS) {
      if (value === "ansprechperson") continue;
      assert.ok(!satz.includes(label), `the receipt sentence claims ${label} was written to`);
    }

    // The same widening in words rather than in labels: „und die beiden anderen Kontaktpersonen“.
    assert.doesNotMatch(satz, /drei|beide|andere|alle/i, "the receipt sentence widens its recipient set in words");

    // The decision DOES reach all three, and the panel has to say so or the applicant waits on nothing.
    const spaeter = absatz.slice(absatz.indexOf(satz) + satz.length);
    assert.match(spaeter, /alle[nr]? drei/, "the panel never says the decision reaches all three");
  });
});

describe("what stands in for a session on the two public routes", () => {
  /* The guard compared WHOLE, not searched: every weakening leaves the words a search looks for
     standing. A deleted `return` is invisible to `tsc` and to ESLint at --max-warnings 0, a bare
     call being a side effect. */
  it("returns the refusal from the guard, on exactly the condition it declares", () => {
    const kopf = 'const secFetchSite = request.headers.get("sec-fetch-site");';
    const ab = PUBLIC_ROUTE.slice(PUBLIC_ROUTE.indexOf(kopf) + kopf.length);
    const bedingung = ab.slice(ab.indexOf("if (") + "if (".length, ab.indexOf(") {"));
    // Cut at the statement's own semicolon: the first `}` after the brace belongs to the object
    // literal inside the call, not to the block.
    const rumpf = ab.slice(ab.indexOf(") {") + ") {".length, ab.indexOf(";", ab.indexOf(") {")) + 1);

    assert.ok(PUBLIC_ROUTE.includes(kopf), "the spine no longer reads Sec-Fetch-Site");
    // `null` passes deliberately: a browser too old to send the header is still a reader of this page.
    assert.equal(bedingung, 'secFetchSite !== null && secFetchSite !== "same-origin"', "the condition was widened or made conditional");
    // RETURNED, not merely constructed: dropped, the response is discarded and the write runs on.
    assert.equal(
      rumpf.trim(),
      "return NextResponse.json({ success: false, error: FREMDE_HERKUNFT });",
      "the guard builds a refusal it does not return, or answers with something else",
    );
  });

  /* 200 with the outcome in the body, as the spine's own closing comment requires: every caller
     throws on a non-2xx and reports the throw as a connection fault, so a status here sends a
     reader to check a network that is fine. */
  it("answers the refusal in German the caller actually renders", () => {
    for (const [name, source] of [
      ["the public spine", PUBLIC_ROUTE],
      ["the undo spine", UNDO_ROUTE],
    ] as const) {
      assert.doesNotMatch(source, /status: 403/, `${name} answers a status no caller reads past`);
      assert.doesNotMatch(source, /"Access Denied"/, `${name} still carries the English nothing renders`);
      assert.match(source, /const FREMDE_HERKUNFT =/, `${name} names no sentence for a cross-site caller`);
      assert.match(source, /kam nicht von dieser Seite/, `${name} no longer says where the request came from`);
      assert.doesNotMatch(source, /Verbindung/, `${name} sends a cross-site caller to check their connection`);
    }

    // The admin's half the old sentence got right: the undo did not happen and the change stands.
    assert.match(UNDO_ROUTE, /Die Änderung steht weiterhin\./, "the undo refusal stopped saying the change still stands");
  });

  /* Ordering read off the source, not off two `indexOf` positions a moved guard leaves unchanged:
     what makes this a guard is that nothing runs behind it. */
  it("seats the guard ahead of every statement that does work", () => {
    const rumpf = PUBLIC_ROUTE.slice(PUBLIC_ROUTE.indexOf("): Promise<NextResponse> {"));
    const vorWache = rumpf.slice(0, rumpf.indexOf("const secFetchSite"));

    assert.doesNotMatch(vorWache, /\bawait\b|\brun\(\)|runWithIncomingCorrelationId/, "work happens before the guard decides");
  });

  /* The edge limits this location per address, so a floor spends requests the complete codes need.
     The width is READ from the constant, so route and form cannot disagree about a complete code. */
  it("judges the Kürzel at exactly the width the constant declares", () => {
    const KUERZEL_ROUTE = readFileSync(path.join(APP_DIR, "api", "bewerbung", "kuerzel", "route.ts"), "utf8");

    assert.match(KUERZEL_ROUTE, /z\.string\(\)\.trim\(\)\.length\(KUERZEL_LAENGE\)/, "the route judges a width it spells itself");
    assert.doesNotMatch(KUERZEL_ROUTE, /\.min\(|\.max\(/, "the route accepts a range where the form accepts one width");
  });

  /* `runAdminMutation`'s name says a session was checked. A public route reaching for it would read
     as authorized by something, and nothing here authorizes anything. */
  it("does not borrow the admin spine", () => {
    assert.doesNotMatch(POST_ROUTE, /runAdminMutation/, "a session-less route runs through the admin mutation spine");
    assert.match(POST_ROUTE, /handlePublicRequest\(request, \{/, "the route no longer runs through the public spine");
  });
});
