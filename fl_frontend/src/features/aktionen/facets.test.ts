import { assert, describe, expect, it } from "vitest";

import { applyFacets, countFacetOptions, isFacetOptionReachable, readFacetSelection } from "@/shared/utils/facets.ts";

import { AKTION_HERKUNFT_LABELS, AKTOR_HERKUNFT } from "./constants.ts";
import {
  AKTIONEN_COLLECTION_PARAM,
  AKTIONEN_FACETS,
  AKTIONEN_HERKUNFT_PARAM,
  AKTIONEN_OPERATION_PARAM,
  aktionenLogFacetCounts,
  aktionenLogFacetTerms,
} from "./facets.ts";

import type { ActionLogGetActionLogParams, FLActionLogEntry } from "@/core/generated/client/types.ts";
import type { Facet, FacetSelection } from "@/shared/utils/facets.ts";
// A type import, and it has to be: `./queries.ts` reaches `next/headers`, which the runner resolves
// to no file, so importing the read as a value would fail this file before a case ran.
import type { getAktionen } from "./queries.ts";

/** The facet under test, cut out by its parameter. */
const HERKUNFT_FACET = AKTIONEN_FACETS.find((facet) => facet.param === AKTIONEN_HERKUNFT_PARAM);

/** One row, of which only the actor carries anything the facet under test reads. */
function row(id: string, actor: FLActionLogEntry["actor"]): FLActionLogEntry {
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
    anlass: null,
    stand_secured: true,
  };
}

/** A valid actor of each kind: a signed-in person carries a pseudonym and a Funktion where every other kind carries `email`. */
function actorOf(kind: FLActionLogEntry["actor"]["kind"]): FLActionLogEntry["actor"] {
  return kind === "person_session"
    ? { kind: kind, pseudonym: "5e".repeat(32), funktion: "kontakt" }
    : { kind: kind, email: `${kind}@beispiel.de`, email_barred: false };
}

/** One row per kind the origin map places, which its type holds to every kind the read model accepts. */
const ROWS = (Object.keys(AKTOR_HERKUNFT) as FLActionLogEntry["actor"]["kind"][]).map((kind, index) =>
  row(`row-${String(index)}`, actorOf(kind)),
);

const PUBLIC_ROW = ROWS.find((entry) => entry.actor.kind === "public");

describe("the origin facet on the change log", () => {
  /* First: a facet the cut no longer finds would leave every assertion below reading `undefined`. */
  it("offers the origin as a facet at all", () => {
    assert.ok(HERKUNFT_FACET, "no facet reads the origin parameter");
    expect(HERKUNFT_FACET.label).toBe("Herkunft");
    assert.ok(PUBLIC_ROW, "no row was built for a public submission, so nothing below tests one");
  });

  /* Derived from the label map rather than spelled here as well: an origin named there and offered
     nowhere is a filter that cannot reach the rows filed under it. */
  it("offers every origin the app names, in the order it names them", () => {
    expect(HERKUNFT_FACET?.options.map((option) => option.value)).toStrictEqual(Object.keys(AKTION_HERKUNFT_LABELS));
    expect(HERKUNFT_FACET?.options.map((option) => option.label)).toStrictEqual(Object.values(AKTION_HERKUNFT_LABELS));
  });

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

/** The other two dimensions, cut out by the parameters the endpoint spells them with. */
const AREA_FACET = AKTIONEN_FACETS.find((facet) => facet.param === AKTIONEN_COLLECTION_PARAM);
const KIND_FACET = AKTIONEN_FACETS.find((facet) => facet.param === AKTIONEN_OPERATION_PARAM);

describe("the dimensions the read itself narrows on", () => {
  /* First: a facet the cut fails to find would leave every assertion below reading `undefined`. */
  it("offers the area and the operation as facets at all", () => {
    assert.ok(AREA_FACET, "no facet reads the area parameter");
    assert.ok(KIND_FACET, "no facet reads the operation parameter");
  });

  /* Held by `tsc` against the generated query type, so a backend rename fails the type check rather than leaving
     every term the bar sends naming a parameter the endpoint does not read. */
  it("writes the endpoint's own parameter names", () => {
    type Unpublished = Exclude<keyof ReturnType<typeof aktionenLogFacetTerms>, keyof ActionLogGetActionLogParams>;
    /** Instantiable while nothing is unpublished, and by no other argument. */
    type EveryTermPublished<T extends never> = T[];

    const unpublished: EveryTermPublished<Unpublished> = [];

    expect(unpublished).toStrictEqual([]);
  });

  /* Held by `tsc` rather than by an assertion, a declaration reaching no runtime: a term the read does
     not declare rides the spread in `./queries.ts` past the excess-property check. */
  it("names every term as a filter the read itself declares", () => {
    type Undeclared = Exclude<keyof ReturnType<typeof aktionenLogFacetTerms>, keyof NonNullable<Parameters<typeof getAktionen>[0]>>;
    /** Instantiable while nothing is undeclared, and by no other argument. */
    type EveryTermDeclared<T extends never> = T[];

    const undeclared: EveryTermDeclared<Undeclared> = [];

    // The declaration above is the case; this is what reaches the runner, which passes an empty one.
    expect(undeclared).toStrictEqual([]);

    // One key per facet, so a dimension the bar offers and the reader forgets fails here too.
    expect(Object.keys(aktionenLogFacetTerms({})).sort()).toStrictEqual(AKTIONEN_FACETS.map((facet) => facet.param).sort());
  });
});

describe("what the log asks the endpoint to narrow to", () => {
  it("asks for none of them while the URL names none", () => {
    expect(aktionenLogFacetTerms({})).toStrictEqual({ collection: undefined, operation: undefined, herkunft: undefined });
  });

  it("forwards a picked area", () => {
    expect(aktionenLogFacetTerms({ [AKTIONEN_COLLECTION_PARAM]: "teams" }).collection).toStrictEqual(["teams"]);
  });

  it("carries a two-area selection, which is why the parameter is a list on both sides", () => {
    expect(aktionenLogFacetTerms({ [AKTIONEN_COLLECTION_PARAM]: "teams,spiele" }).collection).toStrictEqual(["teams", "spiele"]);
  });

  it("forwards a picked operation on its own parameter", () => {
    expect(aktionenLogFacetTerms({ [AKTIONEN_OPERATION_PARAM]: "insert,delete_many" }).operation).toStrictEqual(["insert", "delete_many"]);
  });

  it("drops a value the facet does not offer rather than sending one the endpoint refuses with a 422", () => {
    // A pasted or hand-edited link is the live case, and the operation parameter is a closed set on
    // the endpoint, so an invented member reaches it as a refusal the page has nothing to render.
    expect(aktionenLogFacetTerms({ [AKTIONEN_COLLECTION_PARAM]: "erfunden" }).collection).toBe(undefined);
    expect(aktionenLogFacetTerms({ [AKTIONEN_OPERATION_PARAM]: "insert,erfunden" }).operation).toStrictEqual(["insert"]);
    expect(aktionenLogFacetTerms({ [AKTIONEN_HERKUNFT_PARAM]: "system,erfunden" }).herkunft).toStrictEqual(["system"]);
  });

  it("asks for nothing once a parameter is emptied, which is the facet turned off", () => {
    expect(aktionenLogFacetTerms({ [AKTIONEN_COLLECTION_PARAM]: "" }).collection).toBe(undefined);
  });
});

/** What one narrowed answer holds: the picked area's rows, the cap having cut every other. */
const ONLY_TEAMS: FLActionLogEntry[] = ROWS.map((entry, index) => ({ ...entry, id: `teams-${String(index)}`, collection: "teams" }));

/** Which options `FilterPanel :: FacetCell` would leave pressable, given the counts it was handed. */
function pressableAreas(counts: Record<string, number>, picked: readonly string[]): string[] {
  return (AREA_FACET?.options ?? [])
    .filter((option) => isFacetOptionReachable(counts[option.value] ?? 0, picked.includes(option.value)))
    .map((option) => option.value);
}

describe("the counts the area facet is told", () => {
  /* The endpoint counts the whole log, so an area whose rows the cap cut stays pressable — or the
     control that hid the rest of the log is what stands between an administrator and it. */
  it("keeps an area reachable whose rows a cut answer never carried", () => {
    expect(pressableAreas({ teams: 40, spielorte: 5 }, ["teams"])).toStrictEqual(["teams", "spielorte"]);
  });

  /* Non-vacuity, and the defect itself: counted against the rows one narrowed read served, every
     other area stands at zero and goes dead. */
  it("loses that area where the counts are taken off the rows served instead", () => {
    const offRows = countFacetOptions([...ONLY_TEAMS], AKTIONEN_FACETS, { [AKTIONEN_COLLECTION_PARAM]: ["teams"] }, AREA_FACET!);

    expect(offRows.spielorte).toBe(0);
    expect(pressableAreas(offRows, ["teams"])).toStrictEqual(["teams"]);
  });

  /* An area nothing in the log holds still counts zero, and an option leading nowhere is worth saying
     so about — the told counts are what tells those two cases apart. */
  it("still refuses an area the log really is empty of", () => {
    expect(pressableAreas({ teams: 40, spielorte: 0 }, ["teams"])).toStrictEqual(["teams"]);
  });
});

/** Two areas, each written by one kind of actor alone, so picking an origin empties one of them outright. */
const MIXED_LOG: FLActionLogEntry[] = [
  { ...row("system-1", { kind: "system", email: "SYSTEM", email_barred: false }), collection: "teams" },
  { ...row("system-2", { kind: "system", email: "SYSTEM", email_barred: false }), collection: "teams" },
  { ...row("person-1", { kind: "admin_session", email: "eine.person@beispiel.de", email_barred: false }), collection: "spielorte" },
];

/**
 * What the endpoint answers for one facet: over the WHOLE log, with every other dimension it narrows on
 * applied and this facet's own selection ignored. The shared counter, so no second exclusion rule exists.
 */
function toldCounts(log: FLActionLogEntry[], selection: FacetSelection, facet: Facet<FLActionLogEntry>): Record<string, number> {
  const narrowing = AKTIONEN_FACETS.filter((candidate) => candidate.narrowsTheRead === true);

  return countFacetOptions([...log], narrowing, selection, facet);
}

describe("the counts the endpoint can answer", () => {
  /* Every dimension, or a told count stands beside a narrowing the endpoint never saw. The cap is what
     makes the two uncomposable: an area's whole-log number cannot say what the loaded page still holds. */
  it("narrows the read on every dimension the bar offers", () => {
    expect(AKTIONEN_FACETS.filter((facet) => facet.narrowsTheRead !== true).map((facet) => facet.param)).toStrictEqual([]);
  });

  /* Non-vacuity, and the reading the case below turns on: unnarrowed, both areas hold rows and both
     are offered. */
  it("offers both areas while no origin is picked", () => {
    expect(pressableAreas(toldCounts(MIXED_LOG, {}, AREA_FACET!), [])).toStrictEqual(["teams", "spielorte"]);
  });

  /* The defect's mirror image: an area counted without the origin selection applied is offered, pressed,
     and answers nothing. */
  it("leaves out an area the picked origin empties", () => {
    const selection = readFacetSelection(AKTIONEN_FACETS, new URLSearchParams(`${AKTIONEN_HERKUNFT_PARAM}=system`));

    expect(pressableAreas(toldCounts(MIXED_LOG, selection, AREA_FACET!), [])).toStrictEqual(["teams"]);
  });

  /* The request half: the endpoint cannot count what it is not told, so the term rides with the two the
     bar already sends. */
  it("asks the endpoint to narrow to a picked origin", () => {
    expect(aktionenLogFacetTerms({ [AKTIONEN_HERKUNFT_PARAM]: "system" }).herkunft).toStrictEqual(["system"]);
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
