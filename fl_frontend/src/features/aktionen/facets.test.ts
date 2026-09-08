import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { applyFacets, countFacetOptions, isFacetOptionReachable, readFacetSelection } from "@/shared/utils/facets.ts";

import { AKTION_HERKUNFT_LABELS } from "./constants.ts";
import {
  AKTIONEN_COLLECTION_PARAM,
  AKTIONEN_FACETS,
  AKTIONEN_HERKUNFT_PARAM,
  AKTIONEN_OPERATION_PARAM,
  aktionenLogFacetCounts,
  aktionenLogFacetTerms,
} from "./facets.ts";
import { FLAktorSchema } from "./schemas.ts";

import type { Facet, FacetSelection } from "@/shared/utils/facets.ts";
import type { FLAktor } from "./schemas.ts";
import type { AdminAktionRow } from "./types.ts";

/** The facet under test, cut out by its parameter. */
const HERKUNFT_FACET = AKTIONEN_FACETS.find((facet) => facet.param === AKTIONEN_HERKUNFT_PARAM);

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
    const selection = readFacetSelection(AKTIONEN_FACETS, new URLSearchParams(`${AKTIONEN_HERKUNFT_PARAM}=public`));

    assert.deepEqual(applyFacets([...ROWS], AKTIONEN_FACETS, selection), [PUBLIC_ROW]);
  });

  it("leaves a public submission out of the signed-in people", () => {
    const selection = readFacetSelection(AKTIONEN_FACETS, new URLSearchParams(`${AKTIONEN_HERKUNFT_PARAM}=person`));
    const narrowed = applyFacets([...ROWS], AKTIONEN_FACETS, selection);

    assert.ok(narrowed.length > 0, "the signed-in people match no row at all, so this proves nothing");
    assert.ok(!narrowed.includes(PUBLIC_ROW!), "a public submission is filed with the people who signed in");
  });
});

/** The other two dimensions, cut out by the parameters the endpoint spells them with. */
const BEREICH_FACET = AKTIONEN_FACETS.find((facet) => facet.param === AKTIONEN_COLLECTION_PARAM);
const ART_FACET = AKTIONEN_FACETS.find((facet) => facet.param === AKTIONEN_OPERATION_PARAM);

const DOCUMENT_PATH = path.resolve(import.meta.dirname, "..", "..", "..", "..", "fl_backend", "openapi.json");
const REGENERATE = "cd fl_backend && uv run python -m tests.openapi_document --write";

/** Every query parameter `GET /aktionen` publishes, read off the document rather than retyped here. */
function publishedQueryNames(): string[] {
  const document = JSON.parse(readFileSync(DOCUMENT_PATH, "utf8")) as {
    paths: Record<string, { get?: { parameters?: { in?: string; name?: string }[] } }>;
  };
  const listed = Object.entries(document.paths).find(([published]) => /^\/api\/v\d+\/aktionen$/.test(published));

  return (listed?.[1].get?.parameters ?? []).filter((parameter) => parameter.in === "query").map((parameter) => String(parameter.name));
}

describe("the dimensions the read itself narrows on", () => {
  /* First: a facet the cut fails to find would leave every assertion below reading `undefined`. */
  it("offers the area and the operation as facets at all", () => {
    assert.ok(BEREICH_FACET, "no facet reads the area parameter");
    assert.ok(ART_FACET, "no facet reads the operation parameter");
  });

  /* Read off the published document, so a backend rename fails here rather than leaving every term the
     bar sends naming a parameter the endpoint does not read. */
  it("writes the endpoint's own parameter names", () => {
    const published = publishedQueryNames();
    // The keys and not one selection's: the reader writes every parameter it can, `undefined` included.
    const sent = Object.keys(aktionenLogFacetTerms({}));

    // First: a path this reader cannot place answers an empty list, on which the comparison below passes.
    assert.ok(published.length > 0, `no GET /aktionen query parameters in openapi.json — refresh it:  ${REGENERATE}`);
    assert.deepEqual(
      sent.filter((name) => !published.includes(name)),
      [],
      `the endpoint publishes ${published.join(", ")} — refresh the document if a term was just added:  ${REGENERATE}`,
    );
  });
});

describe("what the log asks the endpoint to narrow to", () => {
  it("asks for none of them while the URL names none", () => {
    assert.deepEqual(aktionenLogFacetTerms({}), { collection: undefined, operation: undefined, herkunft: undefined });
  });

  it("forwards a picked area", () => {
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
    assert.equal(aktionenLogFacetTerms({ [AKTIONEN_HERKUNFT_PARAM]: "system,erfunden" }).herkunft, "system");
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

/** Two areas, each written by one kind of actor alone, so picking an origin empties one of them outright. */
const GEMISCHTES_PROTOKOLL: AdminAktionRow[] = [
  { ...row("system-1", { kind: "system", email: "SYSTEM" }), collection: "teams" },
  { ...row("system-2", { kind: "system", email: "SYSTEM" }), collection: "teams" },
  { ...row("person-1", { kind: "admin_session", email: "eine.person@beispiel.de" }), collection: "spielorte" },
];

/**
 * What the endpoint answers for one facet: over the WHOLE log, with every other dimension it narrows on
 * applied and this facet's own selection ignored. The shared counter, so no second exclusion rule exists.
 */
function toldCounts(log: AdminAktionRow[], selection: FacetSelection, facet: Facet<AdminAktionRow>): Record<string, number> {
  const narrowing = AKTIONEN_FACETS.filter((candidate) => candidate.narrowsTheRead === true);

  return countFacetOptions([...log], narrowing, selection, facet);
}

describe("the counts the endpoint can answer", () => {
  /* Every dimension, or a told count stands beside a narrowing the endpoint never saw. The cap is what
     makes the two uncomposable: an area's whole-log number cannot say what the loaded page still holds. */
  it("narrows the read on every dimension the bar offers", () => {
    assert.deepEqual(
      AKTIONEN_FACETS.filter((facet) => facet.narrowsTheRead !== true).map((facet) => facet.param),
      [],
    );
  });

  /* Non-vacuity, and the reading the case below turns on: unnarrowed, both areas hold rows and both
     are offered. */
  it("offers both areas while no origin is picked", () => {
    assert.deepEqual(pressableAreas(toldCounts(GEMISCHTES_PROTOKOLL, {}, BEREICH_FACET!), []), ["teams", "spielorte"]);
  });

  /* The defect's mirror image: an area counted without the origin selection applied is offered, pressed,
     and answers nothing. */
  it("leaves out an area the picked origin empties", () => {
    const selection = readFacetSelection(AKTIONEN_FACETS, new URLSearchParams(`${AKTIONEN_HERKUNFT_PARAM}=system`));

    assert.deepEqual(pressableAreas(toldCounts(GEMISCHTES_PROTOKOLL, selection, BEREICH_FACET!), []), ["teams"]);
  });

  /* The request half: the endpoint cannot count what it is not told, so the term rides with the two the
     bar already sends. */
  it("asks the endpoint to narrow to a picked origin", () => {
    assert.equal(aktionenLogFacetTerms({ [AKTIONEN_HERKUNFT_PARAM]: "system" }).herkunft, "system");
  });

  /* A facet absent from the map is counted off the rows served instead (`FilterPanel :: FilterPanelBody`),
     which is the cap counting rather than the endpoint. */
  it("hands the panel a told map for every facet", () => {
    const told = aktionenLogFacetCounts({
      anzahl_je_collection: { teams: 40 },
      anzahl_je_operation: { insert: 7 },
      anzahl_je_herkunft: { system: 2 },
    });

    assert.deepEqual(
      AKTIONEN_FACETS.filter((facet) => told[facet.param] === undefined).map((facet) => facet.param),
      [],
    );
  });
});
