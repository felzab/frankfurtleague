import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyFacets, readFacetSelection } from "@/shared/utils/facets.ts";

import { AKTION_HERKUNFT_LABELS } from "./constants.ts";
import { AKTIONEN_FACETS } from "./facets.ts";
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
    correlation_id: "8f14e45fceea167a",
    request: null,
    collection: "teams",
    operation: "patch_one",
    document_id: "68c1f0a2b3c4d5e6f7a8b9c0",
    db_filter: null,
    modified_count: null,
    redacted_at: null,
    standGesichert: true,
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
