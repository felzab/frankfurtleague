import { assert, describe, expect, it } from "vitest";

import { applyFacets, readFacetSelection } from "@/shared/utils/facets.ts";

import { AKTOR_HERKUNFT } from "./constants.ts";
import {
  AKTIONEN_COLLECTION_PARAM,
  AKTIONEN_FACETS,
  AKTIONEN_HERKUNFT_PARAM,
  AKTIONEN_OPERATION_PARAM,
  aktionenLogFacetCounts,
  aktionenLogFacetTerms,
} from "./facets.ts";

import type { FLActionLogEntry } from "@/core/generated/client/types.ts";

/** The facet under test, cut out by its parameter. */
const HERKUNFT_FACET = AKTIONEN_FACETS.find((facet) => facet.param === AKTIONEN_HERKUNFT_PARAM);

/** One row, of which only the actor carries anything the facet under test reads. */
function row(id: string, actor: FLActionLogEntry["actor"]): FLActionLogEntry {
  return {
    id,
    at: "2026-08-20T14:23:05+00:00",
    actor,
    trace_id: "8f14e45fceea167a",
    request: null,
    collection: "teams",
    operation: "patch_one",
    document_id: "68c1f0a2b3c4d5e6f7a8b9c0",
    db_filter: null,
    modified_count: null,
    redacted_at: null,
    erasure_reason: null,
    stand_secured: true,
  };
}

/** A valid actor of each kind: a signed-in person carries a pseudonym and a Funktion where every other kind carries `email`. */
function actorOf(kind: FLActionLogEntry["actor"]["kind"]): FLActionLogEntry["actor"] {
  return kind === "person_session"
    ? { kind, pseudonym: "5e".repeat(32), funktion: "kontakt" }
    : { kind, email: `${kind}@beispiel.de`, email_barred: false };
}

/** One row per kind the origin map places, which its type holds to every kind the read model accepts. */
const ROWS = (Object.keys(AKTOR_HERKUNFT) as FLActionLogEntry["actor"]["kind"][]).map((kind, index) =>
  row(`row-${String(index)}`, actorOf(kind)),
);

const PUBLIC_ROW = ROWS.find((entry) => entry.actor.kind === "public");

describe("the origin facet on the change log", () => {
  /* Every row answers with exactly one offered value, so no write can fall out of the filter and
     become unreachable — which is what a kind absorbed by a binary would do. */
  it("files a row for every kind under one offered option", () => {
    const offered = new Set(HERKUNFT_FACET?.options.map((option) => option.value));

    for (const item of ROWS) {
      const held = HERKUNFT_FACET?.read(item) ?? [];

      expect(held.length, `a ${item.actor.kind} row answers with ${String(held.length)} values`).toBe(1);
      assert.ok(offered.has(held[0]!), `a ${item.actor.kind} row answers with ${String(held[0])}, which the facet does not offer`);
    }
  });

  /* The application form's own write, which arrives under nobody's session. Filed with the signed-in
     people it would reach an admin as a person named by the `PUBLIC` sentinel. */
  it("narrows to the public submissions on their own", () => {
    const selection = readFacetSelection(AKTIONEN_FACETS, new URLSearchParams(`${AKTIONEN_HERKUNFT_PARAM}=public`));

    expect(applyFacets([...ROWS], AKTIONEN_FACETS, selection)).toStrictEqual([PUBLIC_ROW]);
  });

  it("leaves a public submission out of the signed-in people", () => {
    const selection = readFacetSelection(AKTIONEN_FACETS, new URLSearchParams(`${AKTIONEN_HERKUNFT_PARAM}=person`));
    const narrowed = applyFacets([...ROWS], AKTIONEN_FACETS, selection);

    assert.ok(narrowed.length > 0, "the signed-in people match no row at all, so this proves nothing");
    assert.ok(!narrowed.includes(PUBLIC_ROW!), "a public submission is filed with the people who signed in");
  });
});

describe("what the log asks the endpoint to narrow to", () => {
  it("asks for none of them while the URL names none", () => {
    expect(aktionenLogFacetTerms({})).toStrictEqual({ collection: undefined, operation: undefined, herkunft: undefined });
  });

  it("drops a value the facet does not offer rather than sending one the endpoint refuses with a 422", () => {
    // A pasted or hand-edited link is the live case, and the operation parameter is a closed set on
    // the endpoint, so an invented member reaches it as a refusal the page has nothing to render.
    expect(aktionenLogFacetTerms({ [AKTIONEN_COLLECTION_PARAM]: "erfunden" }).collection).toBe(undefined);
    expect(aktionenLogFacetTerms({ [AKTIONEN_OPERATION_PARAM]: "insert,erfunden" }).operation).toStrictEqual(["insert"]);
    expect(aktionenLogFacetTerms({ [AKTIONEN_HERKUNFT_PARAM]: "system,erfunden" }).herkunft).toStrictEqual(["system"]);
  });
});

describe("the counts the endpoint can answer", () => {
  /* Every dimension, or a told count stands beside a narrowing the endpoint never saw. The cap is what
     makes the two uncomposable: an area's whole-log number cannot say what the loaded page still holds. */
  it("narrows the read on every dimension the bar offers", () => {
    expect(AKTIONEN_FACETS.filter((facet) => facet.narrowsTheRead !== true).map((facet) => facet.param)).toStrictEqual([]);
  });

  /* A facet absent from the map is counted off the rows served instead (`FilterPanel :: FilterPanelBody`),
     which is the cap counting rather than the endpoint. */
  it("hands the panel a told map for every facet", () => {
    const told = aktionenLogFacetCounts({
      count_per_collection: { teams: 40 },
      count_per_operation: { insert: 7 },
      count_per_herkunft: { system: 2 },
    });

    expect(AKTIONEN_FACETS.filter((facet) => told[facet.param] === undefined).map((facet) => facet.param)).toStrictEqual([]);
  });
});
