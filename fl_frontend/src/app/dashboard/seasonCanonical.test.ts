import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { filesUnder } from "@/core/treeWalk.ts";

// The pages compile through its step, which the hook below runs ahead of.
import "@/shared/testing/renderTest.ts";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

const DASHBOARD = import.meta.dirname;

const TEAM_ID = "6780e194677bfbfb5ea8396c";
const VERGANGEN = "2025";

/** Stands in for `next/server`, whose `connection()` is request-only and this process makes no request. */
const CONNECTION_DOUBLE = `export const connection = async () => undefined;`;

/* Every read a page makes, answering a past season and a club in it; the season list is what
   `resolveSaisonId` checks a named season against. */
const QUERY_DOUBLES: [string, string][] = [
  [
    "/src/features/saisons/queries.ts",
    `export const getSaisons = async () => ({ saisons: [{ id: "${VERGANGEN}", status: "past" }, { id: "2026", status: "active" }] });
export const getAdminSaisons = getSaisons;`,
  ],
  [
    "/src/features/teams/queries.ts",
    `export const getTeam = async () => ({ team: { name: "Mainufer", full_name: "Mainufer-Schule" } });
export const getTeams = async () => ({ format: "list", teams: [] });`,
  ],
  ["/src/features/spiele/queries.ts", `export const getSpiele = async () => ({ spiele: [] });`],
  ["/src/features/spieltage/queries.ts", `export const getSpieltage = async () => ({ spieltage: [] });`],
  ["/src/features/spieler/queries.ts", `export const getSpieler = async () => ({ spieler: [] });`],
];

/** Each page's view and loader, doubled whole: this file reads metadata, and no case renders a body. */
const RENDERS_NOTHING = /\/src\/(features\/[a-z]+\/components\/views\/\w+|shared\/components\/ui\/ContentLoader)\.tsx$/;

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/next/server.js")) return { format: "module", source: CONNECTION_DOUBLE, shortCircuit: true };

    const doubled = QUERY_DOUBLES.find(([ending]) => url.endsWith(ending));
    if (doubled !== undefined) return { format: "module", source: doubled[1], shortCircuit: true };

    const view = RENDERS_NOTHING.exec(url);
    if (view !== null) {
      const name = path.basename(url, ".tsx");
      return { format: "module", source: `export const ${name} = () => null;`, shortCircuit: true };
    }

    return nextLoad(url, context);
  },
});

type GenerateMetadata = (props: NextPageProps<{ team_id: string }>) => Promise<Metadata>;

/** Every public page that resolves a season, with the path its canonical names. */
const PAGES: { file: string; path: string }[] = [
  { file: "spielplan/page.tsx", path: "/dashboard/spielplan" },
  { file: "playoffs/page.tsx", path: "/dashboard/playoffs" },
  { file: "saisontabelle/page.tsx", path: "/dashboard/saisontabelle" },
  { file: "spielsuche/page.tsx", path: "/dashboard/spielsuche" },
  { file: "(shared-views)/teams/page.tsx", path: "/dashboard/teams" },
  { file: "(shared-views)/spieler/page.tsx", path: "/dashboard/spieler" },
  { file: "(shared-views)/teams/[team_id]/page.tsx", path: `/dashboard/teams/${TEAM_ID}` },
  { file: "(shared-views)/spieler/[team_id]/page.tsx", path: `/dashboard/spieler/${TEAM_ID}` },
];

/* Loaded rather than read: what a crawler is told is the object `generateMetadata` returns. */
const LOADED = await Promise.all(
  PAGES.map(async (page) => {
    const loaded = (await import(pathToFileURL(path.join(DASHBOARD, page.file)).href)) as { generateMetadata?: GenerateMetadata };
    return { ...page, generateMetadata: loaded.generateMetadata };
  }),
);

const metadataOf = (generateMetadata: GenerateMetadata, searchParams: Record<string, string>) =>
  generateMetadata({ params: Promise.resolve({ team_id: TEAM_ID }), searchParams: Promise.resolve(searchParams) });

describe("the canonical of a season-scoped public page", () => {
  /* The population twice over: a page added under the dashboard that resolves a season, and is missing
     here, would be the one page nothing holds to the rule below. */
  it("is checked on every dashboard page that resolves a season", () => {
    const resolving = filesUnder(DASHBOARD, (name) => name === "page.tsx", 5)
      .filter((file) => readFileSync(file, "utf8").includes("resolveSaisonId("))
      .map((file) => path.relative(DASHBOARD, file).split(path.sep).join("/"))
      .sort();

    assert.deepEqual(resolving, PAGES.map((page) => page.file).sort());
  });

  for (const { file, path: pagePath, generateMetadata } of LOADED) {
    /* The bare path shows the running season, so a past season's club page declaring it names a page
       that answers „nicht gefunden“, and a past Spielplan names another year's fixtures. */
    it(`names the season the URL names, on the card as well: ${file}`, async () => {
      assert.ok(generateMetadata, `${file} generates no metadata, so its canonical cannot name the season`);
      const metadata = await metadataOf(generateMetadata, { saison_id: VERGANGEN });
      const expected = `${pagePath}?saison_id=${VERGANGEN}`;

      assert.equal(metadata.alternates?.canonical, expected);
      assert.equal(metadata.openGraph?.url, expected);
      // The description beside that canonical: a past season's page calling itself the running one.
      assert.doesNotMatch(String(metadata.description ?? ""), /laufenden Saison/);
    });

    it(`names the bare path where the URL names no season: ${file}`, async () => {
      assert.ok(generateMetadata);
      const metadata = await metadataOf(generateMetadata, {});

      assert.equal(metadata.alternates?.canonical, pagePath);
      assert.equal(metadata.openGraph?.url, pagePath);
    });
  }
});
