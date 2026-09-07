import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import type { Metadata } from "next";
import type { FLBewerbungFensterResponse } from "./schemas";

const SRC_DIR = path.resolve(import.meta.dirname, "..", "..");
const ROUTE_DIR = path.join(SRC_DIR, "app", "admin", "bewerbungen");

const SIDEMENU = readFileSync(path.join(SRC_DIR, "features", "admin", "constants.ts"), "utf8");
const LIST_PAGE = readFileSync(path.join(ROUTE_DIR, "page.tsx"), "utf8");
const DETAIL_PAGE = readFileSync(path.join(ROUTE_DIR, "[bewerbung_id]", "page.tsx"), "utf8");

/** This slice's own entry, cut out of the structure so the assertions below read one object. */
const ENTRY = /\{\s*id: "([^"]+)",\s*label: "Bewerbungen",[\s\S]*?\n {6}\}/.exec(SIDEMENU);

describe("the route the sidemenu names", () => {
  /* First: an entry the cut no longer finds would leave every assertion below reading `null`. */
  it("finds this slice's entry in the structure at all", () => {
    assert.ok(ENTRY, "no sidemenu entry labelled Bewerbungen was found");
    assert.match(ENTRY[0], /iconName: "\w+"/, "the entry names no icon");
    assert.match(ENTRY[0], /hint: \{/, "the entry carries no hint");
  });

  /* The id IS the route segment: the nav builds its href from it and `AppTopBar` reads the page's
     one `<h1>` off the entry it matches. Renamed, both break and nothing else in the suite sees it. */
  it("names a segment that exists under /admin", () => {
    assert.ok(ENTRY, "no sidemenu entry labelled Bewerbungen was found");
    const id = ENTRY[1]!;

    assert.equal(id, "bewerbungen", "the entry's id moved off this slice's route segment");
    assert.ok(existsSync(path.join(SRC_DIR, "app", "admin", id, "page.tsx")), `/admin/${id} has no page`);
  });

  /* Both segments draw a skeleton while their data resolves; without one the shell holds an empty
     frame for the length of an admin-tier round trip. */
  it("gives both segments a loading state", () => {
    assert.ok(existsSync(path.join(ROUTE_DIR, "loading.tsx")), "the list segment has no loading.tsx");
    assert.ok(existsSync(path.join(ROUTE_DIR, "[bewerbung_id]", "loading.tsx")), "the detail segment has no loading.tsx");
  });
});

describe("where each page opts out of prerendering", () => {
  /* `docs/frontend/spec.md :: I22`: awaited INSIDE the boundary, so the chrome renders while the
     read runs. Dropped, only ESLint's unused-import rule stands between it and a prerender. */
  for (const [page, where] of [
    [LIST_PAGE, "the list page"],
    [DETAIL_PAGE, "the detail page"],
  ] as const) {
    it(`${where} awaits connection() inside the boundary`, () => {
      assert.match(page, /import \{ connection \} from "next\/server";/, `${where} no longer imports connection`);
      assert.match(page, /await connection\(\);/, `${where} no longer awaits connection`);

      const [chrome, boundary] = page.split("<Suspense");
      assert.ok(boundary !== undefined, `${where} renders no Suspense boundary`);
      assert.ok(!chrome!.includes("await connection()"), `${where} awaits connection above its own boundary`);
    });

    it(`${where} exports a synchronous default`, () => {
      assert.match(page, /^export default function /m, `${where} awaits its data before the chrome renders`);
      assert.doesNotMatch(page, /^export default async /m, `${where} awaits its data before the chrome renders`);
    });
  }
});

describe("how the list page reads the header's season", () => {
  /* The selector writes `?saison_id=`, and the page reaches it only through its own props: without
     the parameter forwarded, the season resolves to `undefined` on every navigation. */
  it("forwards the page's searchParams into the boundary", () => {
    assert.match(LIST_PAGE, /searchParams=\{props\.searchParams\}/, "the list page keeps its search parameters from the boundary");
  });

  /* The `"admin"` tier, or a planned season the selector offers is redirected straight back off:
     `fl_frontend/src/features/saisons/resolvers.ts :: resolveSaisonId`. */
  it("resolves the season at the admin tier", () => {
    assert.match(LIST_PAGE, /resolveSaisonId\(searchParams, "admin"\)/, "the list page no longer resolves the season at the admin tier");
  });

  /* Where the season actually lands: the rows carry it, and the facet reads it off them. Dropped,
     every row would answer the season facet the same way and the list would open on nothing. */
  it("hands the resolved season to the row build", () => {
    assert.match(LIST_PAGE, /buildBewerbungRows\([^)]*selectedSaisonId\)/, "the season never reaches the rows the facet reads");
    assert.match(LIST_PAGE, /status === "active"/, "the page no longer falls back to the active season");
  });
});

/**
 * Every JSX attribute whose value mentions `name`, and how many element CHILDREN do. Read off the
 * syntax tree: a text search cannot tell an attribute from a child, and the attribute is the half
 * that turns a stored value into a sink.
 */
function whereValueLands(source: string, file: string, name: string): { attributes: string[]; children: number } {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const attributes: string[] = [];
  let children = 0;

  const mentions = (node: ts.Node): boolean => {
    if (ts.isIdentifier(node) && node.text === name) return true;
    return node.getChildren(tree).some(mentions);
  };

  const visit = (node: ts.Node): void => {
    if (ts.isJsxAttribute(node) && node.initializer !== undefined && mentions(node.initializer)) {
      attributes.push(`${node.name.getText(tree)} at line ${String(tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1)}`);
    }
    if (ts.isJsxExpression(node) && ts.isJsxElement(node.parent) && node.expression !== undefined && mentions(node.expression)) children += 1;

    node.forEachChild(visit);
  };
  visit(tree);

  return { attributes: attributes, children: children };
}

describe("how the triage renders what the applicant typed", () => {
  const PANEL_FILE = path.join(SRC_DIR, "features", "bewerbungen", "components", "views", "BewerbungAngabenPanel.tsx");
  const PANEL = readFileSync(PANEL_FILE, "utf8");
  const gefunden = whereValueLands(PANEL, PANEL_FILE, "wunschgegner");

  /* First: a panel that had stopped rendering the value would satisfy the sink assertion below by
     rendering nothing at all, which is the one way a safety check must not pass. */
  it("renders the wish somewhere in the panel", () => {
    assert.ok(gefunden.children > 0, "the triage panel no longer renders the wished opponent at all");
  });

  /* Applicant-controlled and read by an administrator. As element CONTENT React escapes it; in an
     attribute it is an `href` or a `srcDoc` away from executing. */
  it("puts it in element content and in no attribute", () => {
    assert.deepEqual(gefunden.attributes, [], `the wished opponent reaches a JSX attribute: ${gefunden.attributes.join(", ")}`);
  });

  /* The other half of the same rule, and the one ESLint's `react/no-danger` would catch -- asserted
     here too because `.claude/rules/cross-surface.md` forbids disabling that rule, so a suppression comment is the way past it. */
  it("hands the panel no raw markup at all", () => {
    assert.doesNotMatch(PANEL, /dangerouslySetInnerHTML/, "the triage panel writes raw markup, which stored applicant text can reach");
  });
});

/** Where the doubled window read takes its answer from, one case at a time. */
const ANTWORT = "__flBewerbungFensterAntwort";

/* The page's own three reads. A case sets what the window read answers; the two beside it are read
   inside the boundary alone, which no case here renders. */
const BEWERBUNGEN_QUERIES_DOUBLE = `export const getBewerbungFenster = async () => globalThis.${ANTWORT};
export const getBewerbungSchulen = async () => ({ schulen: [] });
export const getBewerbungTrikotfarben = async () => ({ vergeben: [] });`;

const SAISONS_QUERIES_DOUBLE = `export const getSaisons = async () => ({ saisons: [] });
export const getAdminSaisons = async () => ({ saisons: [] });`;

const RENDERS_NOTHING = `export const BewerbungView = () => null;
export const ContentLoader = () => null;`;

/** Stands in for `next/server`, whose `connection()` is request-only and this process makes no request. */
const CONNECTION_DOUBLE = `export const connection = async () => undefined;`;

/* Everything under the page is doubled -- its reads, its view, its loader and the season list the
   segment resolver imports -- so a case decides what the window answer does to the metadata. */
const DOUBLED: [string, string][] = [
  ["/src/features/bewerbungen/queries.ts", BEWERBUNGEN_QUERIES_DOUBLE],
  ["/src/features/saisons/queries.ts", SAISONS_QUERIES_DOUBLE],
  ["/src/features/bewerbungen/components/views/BewerbungView.tsx", RENDERS_NOTHING],
  ["/src/shared/components/ui/ContentLoader.tsx", RENDERS_NOTHING],
];

registerHooks({
  resolve(specifier, context, nextResolve) {
    // Node resolves the package's subpaths only with their extension; Next's own bundler needs none.
    if (specifier === "next/server" || specifier === "next/navigation") return nextResolve(`${specifier}.js`, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith("/next/server.js")) return { format: "module", source: CONNECTION_DOUBLE, shortCircuit: true };

    const doubled = DOUBLED.find(([ending]) => url.endsWith(ending));
    if (doubled !== undefined) return { format: "module", source: doubled[1], shortCircuit: true };
    if (!url.endsWith(".tsx")) return nextLoad(url, context);

    // The runner strips types and compiles no JSX, and the page's own body is JSX.
    const compiled = ts.transpileModule(readFileSync(fileURLToPath(url), "utf8"), {
      compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX },
    }).outputText;

    return { format: "module", shortCircuit: true, source: compiled };
  },
});

/* Loaded rather than read: what a crawler is told is the object `generateMetadata` returns, and no
   assertion over the page's source text can show that. */
const { generateMetadata } = await import("@/app/(public)/bewerbung/[saison_id]/page.tsx");

/** One season's metadata, with the window read answering `antwort`. */
async function metadataFor(antwort: { fenster: FLBewerbungFensterResponse | null } | null): Promise<Metadata> {
  (globalThis as unknown as Record<string, unknown>)[ANTWORT] = antwort;

  return generateMetadata({ params: Promise.resolve({ saison_id: "2026" }), searchParams: Promise.resolve({}) });
}

const ABGELAUFEN: FLBewerbungFensterResponse = {
  acknowledged: 1,
  saison_id: "2026",
  offen: true,
  von: "2026-03-01",
  bis: "2026-04-30",
  laeuft: false,
};

describe("what the public application page tells a crawler about its season", () => {
  /* The whole of what a mistyped year gets: `notFound()` from the metadata, which is the earliest the
     answer is known. Raised in the body instead, the page it 404s has already rendered its sentence. */
  it("answers not-found where no season carries the id", async () => {
    await assert.rejects(
      () => metadataFor(null),
      (error: Error & { digest?: string }) => error.digest === "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  });

  /* A season nobody has recorded a deadline for renders one sentence and no form. Indexed, that
     sentence is what a school searching for this league finds long after the window opened. */
  it("asks not to be indexed where the season records no deadline", async () => {
    assert.deepEqual((await metadataFor({ fenster: null })).robots, { index: false });
  });

  /* The control, and the boundary of the directive: a deadline that has passed is a real answer for
     the season it names, so the page stays a page a crawler may keep. */
  it("leaves a season whose deadline has passed indexable", async () => {
    assert.equal((await metadataFor({ fenster: ABGELAUFEN })).robots, undefined);
  });
});
