import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { leserichtungHref, parseLeserichtung } from "@/features/bewerbungen/utils.ts";
import { applyFacets, countFacetOptions, isFacetOptionReachable, readFacetSelection } from "@/shared/utils/facets.ts";

import { AKTION_HERKUNFT_LABELS } from "./constants.ts";
import { AKTIONEN_COLLECTION_PARAM, AKTIONEN_FACETS, AKTIONEN_OPERATION_PARAM, aktionenLeserichtung, aktionenLogFacetTerms } from "./facets.ts";
import { FLAktorSchema } from "./schemas.ts";

import type { FLAktor } from "./schemas.ts";
import type { AdminAktionRow } from "./types.ts";

/** Spelled out so a rename fails here rather than silently. */
const HERKUNFT_PARAM = "herkunft";

/** The facet under test, cut out by its parameter. */
const HERKUNFT_FACET = AKTIONEN_FACETS.find((facet) => facet.param === HERKUNFT_PARAM);

/** One row, of which only the actor carries anything the facet under test reads. */
function row(id: string, actor: FLAktor): AdminAktionRow {
  return {
    id: id,
    at: "2026-08-20T14:23:05+00:00",
    actor: actor,
    trace_id: "8f14e45fceea167a",
    request: null,
    collection: "teams",
    operation: "patch_one",
    document_id: "68c1f0a2b3c4d5e6f7a8b9c0",
    db_filter: null,
    modified_count: null,
    redacted_at: null,
    stand_gesichert: true,
  };
}

/** One row per kind the read model accepts, so a kind added there is swept without anyone listing it. */
const ROWS = FLAktorSchema.shape.kind.options.map((kind, index) => row(`row-${String(index)}`, { kind: kind, email: `${kind}@beispiel.de` }));

const PUBLIC_ROW = ROWS.find((entry) => entry.actor.kind === "public");

describe("the origin facet on the change log", () => {
  /* First: a facet the cut no longer finds would leave every assertion below reading `undefined`. */
  it("offers the origin as a facet at all", () => {
    assert.ok(HERKUNFT_FACET, "no facet reads the origin parameter");
    assert.equal(HERKUNFT_FACET.label, "Herkunft");
    assert.ok(PUBLIC_ROW, "no row was built for a public submission, so nothing below tests one");
  });

  /* Derived from the label map rather than spelled here as well: an origin named there and offered
     nowhere is a filter that cannot reach the rows filed under it. */
  it("offers every origin the app names, in the order it names them", () => {
    assert.deepEqual(
      HERKUNFT_FACET?.options.map((option) => option.value),
      Object.keys(AKTION_HERKUNFT_LABELS),
    );
    assert.deepEqual(
      HERKUNFT_FACET?.options.map((option) => option.label),
      Object.values(AKTION_HERKUNFT_LABELS),
    );
  });

  /* Every row answers with exactly one offered value, so no write can fall out of the filter and
     become unreachable — which is what a kind absorbed by a binary would do. */
  it("files a row for every kind under one offered option", () => {
    const offered = new Set(HERKUNFT_FACET?.options.map((option) => option.value));

    for (const item of ROWS) {
      const held = HERKUNFT_FACET?.read(item) ?? [];

      assert.equal(held.length, 1, `a ${item.actor.kind} row answers with ${String(held.length)} values`);
      assert.ok(offered.has(held[0]!), `a ${item.actor.kind} row answers with ${String(held[0])}, which the facet does not offer`);
    }
  });

  /* The application form's own write, which arrives under nobody's session. Filed with the signed-in
     people it would reach an admin as a person named by the `PUBLIC` sentinel. */
  it("narrows to the public submissions on their own", () => {
    const selection = readFacetSelection(AKTIONEN_FACETS, new URLSearchParams(`${HERKUNFT_PARAM}=public`));

    assert.deepEqual(applyFacets([...ROWS], AKTIONEN_FACETS, selection), [PUBLIC_ROW]);
  });

  it("leaves a public submission out of the signed-in people", () => {
    const selection = readFacetSelection(AKTIONEN_FACETS, new URLSearchParams(`${HERKUNFT_PARAM}=person`));
    const narrowed = applyFacets([...ROWS], AKTIONEN_FACETS, selection);

    assert.ok(narrowed.length > 0, "the signed-in people match no row at all, so this proves nothing");
    assert.ok(!narrowed.includes(PUBLIC_ROW!), "a public submission is filed with the people who signed in");
  });
});

/** The two dimensions the endpoint narrows on, cut out by the parameters it spells them with. */
const BEREICH_FACET = AKTIONEN_FACETS.find((facet) => facet.param === AKTIONEN_COLLECTION_PARAM);
const ART_FACET = AKTIONEN_FACETS.find((facet) => facet.param === AKTIONEN_OPERATION_PARAM);

describe("the two dimensions the read itself narrows on", () => {
  /* First: a facet the cut fails to find would leave every assertion below reading `undefined`. */
  it("offers both, each marked as one the read narrows on", () => {
    assert.ok(BEREICH_FACET, "no facet reads the area parameter");
    assert.ok(ART_FACET, "no facet reads the operation parameter");
    // Without the mark `useUrlFilters` writes history alone, so picking an area would filter the rows
    // already loaded rather than asking for the ones the endpoint's cap left out.
    assert.equal(BEREICH_FACET.narrowsTheRead, true);
    assert.equal(ART_FACET.narrowsTheRead, true);
  });

  /* Spelled as the endpoint spells its own term, so the selection is forwarded rather than translated:
     a second spelling is a mapping table two sides can disagree about. */
  it("writes the endpoint's own parameter names", () => {
    assert.equal(AKTIONEN_COLLECTION_PARAM, "collection");
    assert.equal(AKTIONEN_OPERATION_PARAM, "operation");
  });
});

describe("what the log asks the endpoint to narrow to", () => {
  it("asks for neither while the URL names neither", () => {
    assert.deepEqual(aktionenLogFacetTerms({}), { collection: undefined, operation: undefined });
  });

  it("forwards a picked area, which is the whole of the server-side narrowing", () => {
    assert.equal(aktionenLogFacetTerms({ [AKTIONEN_COLLECTION_PARAM]: "teams" }).collection, "teams");
  });

  it("carries a two-area selection, which is why the parameter is a list on both sides", () => {
    assert.equal(aktionenLogFacetTerms({ [AKTIONEN_COLLECTION_PARAM]: "teams,spiele" }).collection, "teams,spiele");
  });

  it("forwards a picked operation on its own parameter", () => {
    assert.equal(aktionenLogFacetTerms({ [AKTIONEN_OPERATION_PARAM]: "insert,delete_many" }).operation, "insert,delete_many");
  });

  it("drops a value the facet does not offer rather than sending one the endpoint refuses with a 422", () => {
    // A pasted or hand-edited link is the live case, and the operation parameter is a closed set on
    // the endpoint, so an invented member reaches it as a refusal the page has nothing to render.
    assert.equal(aktionenLogFacetTerms({ [AKTIONEN_COLLECTION_PARAM]: "erfunden" }).collection, undefined);
    assert.equal(aktionenLogFacetTerms({ [AKTIONEN_OPERATION_PARAM]: "insert,erfunden" }).operation, "insert");
  });

  it("asks for nothing once a parameter is emptied, which is the facet turned off", () => {
    assert.equal(aktionenLogFacetTerms({ [AKTIONEN_COLLECTION_PARAM]: "" }).collection, undefined);
  });
});

/** What one narrowed answer holds: the picked area's rows, the cap having cut every other. */
const NUR_TEAMS: AdminAktionRow[] = ROWS.map((entry, index) => ({ ...entry, id: `teams-${String(index)}`, collection: "teams" }));

/** Which options `FilterPanel :: FacetCell` would leave pressable, given the counts it was handed. */
function pressableAreas(counts: Record<string, number>, picked: readonly string[]): string[] {
  return (BEREICH_FACET?.options ?? [])
    .filter((option) => isFacetOptionReachable(counts[option.value] ?? 0, picked.includes(option.value)))
    .map((option) => option.value);
}

describe("the counts the area facet is told", () => {
  /* The endpoint counts the whole log, so an area whose rows the cap cut stays pressable — or the
     control that hid the rest of the log is what stands between an administrator and it. */
  it("keeps an area reachable whose rows a cut answer never carried", () => {
    assert.deepEqual(pressableAreas({ teams: 40, spielorte: 5 }, ["teams"]), ["teams", "spielorte"]);
  });

  /* Non-vacuity, and the defect itself: counted against the rows one narrowed read served, every
     other area stands at zero and goes dead. */
  it("loses that area where the counts are taken off the rows served instead", () => {
    const offRows = countFacetOptions([...NUR_TEAMS], AKTIONEN_FACETS, { [AKTIONEN_COLLECTION_PARAM]: ["teams"] }, BEREICH_FACET!);

    assert.equal(offRows.spielorte, 0);
    assert.deepEqual(pressableAreas(offRows, ["teams"]), ["teams"]);
  });

  /* An area nothing in the log holds still counts zero, and an option leading nowhere is worth saying
     so about — the told counts are what tells those two cases apart. */
  it("still refuses an area the log really is empty of", () => {
    assert.deepEqual(pressableAreas({ teams: 40, spielorte: 0 }, ["teams"]), ["teams"]);
  });
});

/** The URL shapes this log writes, each carrying something a reversal must not drop. */
const LOG_URLS: Record<string, string | string[]>[] = [
  {},
  { [AKTIONEN_COLLECTION_PARAM]: "teams,spiele" },
  { [AKTIONEN_OPERATION_PARAM]: "insert", saison_id: "2026" },
  { document_id: "68c1f0a2b3c4d5e6f7a8b9c0", order: "asc" },
  { q: "name@beispiel.de", [HERKUNFT_PARAM]: ["system", "public"] },
];

/** One URL shape as a query string, repeated keys and all. */
function asSearch(params: Record<string, string | string[]>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) for (const single of Array.isArray(value) ? value : [value]) search.append(key, single);

  return search;
}

describe("the read-order control this log offers", () => {
  it("turns the newest-first default around", () => {
    assert.equal(aktionenLeserichtung(new URLSearchParams()).umkehrHref, "?order=asc");
  });

  it("returns a reversed log to the newest first, and says which end it holds", () => {
    const gedreht = aktionenLeserichtung(new URLSearchParams("order=asc"));

    assert.equal(gedreht.richtung, "asc");
    assert.equal(gedreht.umkehrHref, "?order=desc");
  });

  /* The applications queue's own builder and never a second one: two implementations drift on
     exactly the parameters only one of the two surfaces has. */
  it("writes the href the applications queue's own caller writes", () => {
    for (const params of LOG_URLS) {
      assert.equal(aktionenLeserichtung(asSearch(params)).umkehrHref, leserichtungHref(params, parseLeserichtung(params)));
    }
  });

  it("keeps every narrowing the bar wrote, so reversing the log never drops a filter", () => {
    for (const params of LOG_URLS) {
      const { richtung, umkehrHref } = aktionenLeserichtung(asSearch(params));
      const reversed = new URLSearchParams(umkehrHref.slice(1));

      for (const [key, value] of Object.entries(params)) {
        if (key === "order") continue;
        assert.deepEqual(reversed.getAll(key), Array.isArray(value) ? value : [value], `\`${key}\` was dropped by the reversal`);
      }
      assert.equal(reversed.get("order"), richtung === "desc" ? "asc" : "desc");
    }
  });
});
