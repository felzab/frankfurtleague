import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { TEAM_FACETS, TEAMS_ANY_SAISON_QUERY } from "@/features/teams/facets";
import { applyFacets, readFacetSelection } from "@/shared/utils/facets.ts";

import { BEWERBUNGEN_FACETS } from "./facets.ts";

import type { AdminBewerbungRow } from "./types.ts";

/** Spelled out so a rename fails here rather than silently. */
const SAISON_PARAM = "saisonbezug";

/** The facet under test, cut out by its parameter. */
const SAISON_FACET = BEWERBUNGEN_FACETS.find((facet) => facet.param === SAISON_PARAM);

/** One row, of which only the two fields the facets read carry anything. */
function row(id: string, inSelectedSaison: boolean): AdminBewerbungRow {
  return {
    id,
    saison_id: inSelectedSaison ? "2627" : "2526",
    eingereicht_am: "2026-05-01",
    status: "eingereicht",
    team_id: null,
    schule: null,
    kontakte: { trainer: null, ansprechperson: null, stellvertretung: null, trainer_ist_ansprechperson: false },
    trikot: { vorhandener_satz: "", wunschfarbe: null },
    kader: { voraussichtliche_groesse: 14, gute_spieler: null },
    entscheidung: null,
    teamName: null,
    inSelectedSaison,
  };
}

const ROWS = [row("6890a1b2c3d4e5f607190011", true), row("6890a1b2c3d4e5f607190012", false)];

describe("the season facet on the triage list", () => {
  /* First: a facet the cut no longer finds would leave every assertion below reading `undefined`. */
  it("offers the season as a facet at all", () => {
    assert.ok(SAISON_FACET, "no facet reads the season parameter");
    assert.equal(SAISON_FACET.label, "Saison");
    assert.deepEqual(
      SAISON_FACET.options.map((option) => option.label),
      ["In dieser Saison", "Nicht in dieser Saison"],
    );
  });

  /* Its own parameter, never `saison_id`: writing the header selector's parameter would make the two
     controls one, and the facet's second option would move the whole page off the season. */
  it("keeps off the parameter the header selector owns", () => {
    for (const facet of BEWERBUNGEN_FACETS) assert.notEqual(facet.param, "saison_id", `${facet.label} writes the selector's parameter`);
  });

  /* The opening state. An unnarrowed list mixes every season's applications, which is the question
     almost nobody arrives with. */
  it("selects `In dieser Saison` while nothing is in the URL", () => {
    const selection = readFacetSelection(BEWERBUNGEN_FACETS, new URLSearchParams());

    assert.deepEqual(selection[SAISON_PARAM], ["diese_saison"]);
    assert.deepEqual(applyFacets([...ROWS], BEWERBUNGEN_FACETS, selection), [ROWS[0]]);
  });

  /* The archive, one click away: an EMPTY parameter is the reader turning the facet off, and it is
     the one state that outranks a default. */
  it("reaches every season once the parameter is emptied", () => {
    const selection = readFacetSelection(BEWERBUNGEN_FACETS, new URLSearchParams(`${SAISON_PARAM}=`));

    assert.equal(selection[SAISON_PARAM], undefined);
    assert.deepEqual(applyFacets([...ROWS], BEWERBUNGEN_FACETS, selection), ROWS);
  });

  it("narrows to the other seasons where the reader picks them", () => {
    const selection = readFacetSelection(BEWERBUNGEN_FACETS, new URLSearchParams(`${SAISON_PARAM}=andere_saison`));

    assert.deepEqual(applyFacets([...ROWS], BEWERBUNGEN_FACETS, selection), [ROWS[1]]);
  });

  /* Every row answers with exactly one of the two, so no application can fall out of both and become
     unreachable from the list. */
  it("files every row under one of the two options", () => {
    const offered = new Set(SAISON_FACET?.options.map((option) => option.value));

    for (const item of ROWS) {
      const held = SAISON_FACET?.read(item) ?? [];
      assert.equal(held.length, 1);
      assert.ok(offered.has(held[0]!), `a row answers with ${String(held[0])}, which the facet does not offer`);
    }
  });
});

const FEATURES_DIR = path.resolve(import.meta.dirname, "..");
const OWN_MODULE = path.join("bewerbungen", "facets.ts");

/** Every slice's facet module, found on disk so a slice added later is swept without anyone listing it here. */
const FACET_MODULES = readdirSync(FEATURES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(FEATURES_DIR, entry.name, "facets.ts"))
  .filter((file) => existsSync(file));

/** Every facet the app ships, reduced to what a URL can collide over plus where it came from. */
const SWEPT: { param: string; label: string; source: string }[] = [];

for (const file of FACET_MODULES) {
  const loaded = (await import(pathToFileURL(file).href)) as Record<string, unknown>;

  for (const exported of Object.values(loaded)) {
    if (!Array.isArray(exported)) continue;

    for (const entry of exported as unknown[]) {
      const { param, label } = (entry ?? {}) as { param?: unknown; label?: unknown };
      if (typeof param !== "string" || typeof label !== "string") continue;

      SWEPT.push({ param, label, source: path.relative(FEATURES_DIR, file) });
    }
  }
}

const FOREIGN = SWEPT.filter((facet) => facet.source !== OWN_MODULE);

describe("the season parameter this list owns", () => {
  /* First: a sweep that reached nothing would leave the case below iterating an empty set and passing. */
  it("is checked against facets actually loaded from the other slices", () => {
    assert.ok(FACET_MODULES.length > 1, "no other slice's facet module was found to sweep");
    assert.ok(
      FOREIGN.some((facet) => facet.label === SAISON_FACET?.label),
      "the sweep reached no other list asking about the season, so nothing below can collide",
    );
  });

  /* `/admin/teams` labels its season facet identically and answers it in other words. A third list
     spelling this parameter would send links here whose values this facet has no row for, answered
     with the default rather than with what the link meant. */
  it("is spelled by no other list, whatever that list means by it", () => {
    for (const facet of FOREIGN) {
      assert.notEqual(facet.param, SAISON_PARAM, `${facet.source} spells \`${SAISON_PARAM}\`, whose values only this list decides`);
    }
  });

  it("keeps its default when the club list's season value is pasted onto this URL", () => {
    const borrowed = TEAM_FACETS.find((facet) => facet.label === SAISON_FACET?.label)?.options ?? [];
    assert.notEqual(borrowed.length, 0, "the club list offers no season value to borrow");

    for (const option of borrowed) {
      const selection = readFacetSelection(BEWERBUNGEN_FACETS, new URLSearchParams(`${TEAMS_ANY_SAISON_QUERY}${option.value}`));

      assert.deepEqual(selection[SAISON_PARAM], ["diese_saison"], `\`${option.value}\` reached this list's season facet`);
      assert.deepEqual(applyFacets([...ROWS], BEWERBUNGEN_FACETS, selection), [ROWS[0]]);
    }
  });

  /* The club list's own off-switch is a real query string a cross-route link writes, so it is the one
     foreign form that arrives here by accident rather than by hand. */
  it("keeps its default when the club list's off-switch arrives here", () => {
    const selection = readFacetSelection(BEWERBUNGEN_FACETS, new URLSearchParams(TEAMS_ANY_SAISON_QUERY));

    assert.deepEqual(selection[SAISON_PARAM], ["diese_saison"]);
  });
});

/** The list's other way of narrowing, declared beside the facets it sits next to on the same bar. */
const SEARCH_KEYS = (
  readFileSync(path.resolve(import.meta.dirname, "components", "views", "AdminBewerbungenView.tsx"), "utf8").split(
    "const SEARCH_KEYS = [",
  )[1] ?? ""
).split("] as const;")[0];

describe("what the triage list's search reaches", () => {
  /* First: a declaration the cut no longer finds leaves an empty string, in which no key is missing
     and the case below would pass over nothing. */
  it("reads the list's keys out of the view at all", () => {
    // The empty string, never `undefined`: a cut that finds nothing still splits to one element, so a
    // floor asking for a value at all would be met by the miss it exists to catch.
    assert.notEqual(SEARCH_KEYS, "", "no SEARCH_KEYS declaration was found in the view");
    assert.match(SEARCH_KEYS ?? "", /"teamName"/, "the keys were cut to something that does not hold them");
  });

  /* The seats the case below iterates. A shrunk `KONTAKT_ROLLEN` leaves it sweeping fewer seats than
     an application records, and the keys of the seat that left could then go with it, green. */
  it("sweeps every seat an application records before judging the keys", () => {
    assert.equal(
      KONTAKT_ROLLEN.length,
      3,
      `an application records ${String(KONTAKT_ROLLEN.length)} contact seats, not the three this case sweeps`,
    );
  });

  /* All three seats or none. A school names a Stellvertretung as readily as a Trainer, and the admin
     searching a name read off the application has no way to tell a seat nobody indexed from a name
     nobody applied under. */
  it("reaches every contact seat an application records", () => {
    for (const { value, label } of KONTAKT_ROLLEN) {
      assert.ok(SEARCH_KEYS?.includes(`"kontakte.${value}.nachname"`), `a ${label} is unsearchable by name`);
      assert.ok(SEARCH_KEYS?.includes(`"kontakte.${value}.email"`), `a ${label} is unsearchable by address`);
    }
  });
});
