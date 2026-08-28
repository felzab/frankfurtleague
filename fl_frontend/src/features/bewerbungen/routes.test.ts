import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

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
