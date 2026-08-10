/**
 * CORE · the Zod mirror, checked against the published API surface
 *
 * The Pydantic schemas and the Zod `schemas.ts` modules beside this one are hand-maintained with
 * no generation step; this suite converts every exported Zod schema to JSON Schema, pairs it with
 * its component in the committed `fl_backend/openapi.json`, and compares the wire contract —
 * presence, required, nullable, primitive type, enum members (ADR-0033). Patterns, lengths,
 * bounds and messages are deliberately not compared: the two sides diverge there by design, and
 * comparing validation policy produces failures nobody can act on.
 *
 * Invariants:
 * - Every component and Zod schema is either paired or in an exception list with its reason.
 * - Modules are walked and imported dynamically — a new slice is covered with nothing to
 *   remember, and `core` gains no static import of `features` or `shared` (ADR-0008).
 * - Nested objects are not recursed into: each is its own pair, so a drift names the smallest
 *   component that moved.
 *
 * See:
 * - fl_backend/tests/api/test_openapi_document.py — what keeps the document this reads in step
 */

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import z from "zod";

const SRC_DIR = path.resolve(import.meta.dirname, "..");
const DOCUMENT_PATH = path.resolve(SRC_DIR, "..", "..", "fl_backend", "openapi.json");

const REGENERATE = "cd fl_backend && python -m tests.openapi_document --write";

/**
 * Backend component name → the frontend export it is mirrored by, where the two names differ.
 *
 * An alias keeps a pair CHECKED. Listing one of these as an exception instead would silently drop a
 * real mirror out of the comparison, which is the opposite of what the exception lists are for.
 */
const NAME_ALIASES: Record<string, string> = {
  // The system schemas are named for the function that returns them (`checkIsLive`, `getSystemInfo`),
  // which is the frontend's convention for a query's return type and not a mismatch to correct.
  CheckIsLiveResponse: "CheckIsLiveReturn",
  CheckIsReadyResponse: "CheckIsReadyReturn",
  SystemInfoResponse: "GetSystemInfoReturn",
  // One backend response serves DELETE and reactivate both; the frontend only calls DELETE and names
  // its mirror after the action.
  FLSchiedsrichterWriteResponse: "FLDeleteSchiedsrichterResponse",
  FLSpielortWriteResponse: "FLDeleteSpielortResponse",

  // The backend keeps a separate model for STORED documents, and only
  // `FLSpielJoined` reaches the wire. The frontend parses no stored document, so
  // it has one shape and names it `FLSpiel`.
  FLSpielJoined: "FLSpiel",
};

/**
 * Components with no Zod mirror. Every entry is a deliberate absence, not a gap to close later.
 *
 * Adding a response model on the backend fails the pairing test until it is either mirrored or written
 * here — which is the whole point of keeping the list by hand.
 */
const BACKEND_ONLY: Record<string, string> = {
  // FastAPI's own 422 body. `apiClient` throws APIBadStatusError on any non-2xx before a schema runs,
  // so no frontend schema ever sees either of these.
  HTTPValidationError: "FastAPI's validation error body; thrown on before any schema parses it",
  ValidationError: "FastAPI's validation error body; thrown on before any schema parses it",

  // ADR-0027 gives every resource a GET /{id} for uniform addressability, and not
  // every one is called; the uncalled ones have no mirror, which the backend spec
  // records as known-open. `/saisons/current` is why the season pair is mirrored.
  FLSchiedsrichterSingleResponse: "GET /{id} exists for uniform addressability and has no caller (ADR-0027)",
  FLSpielorteSingleResponse: "GET /{id} exists for uniform addressability and has no caller (ADR-0027)",
  FLSpieltageSingleResponse: "GET /{id} exists for uniform addressability and has no caller (ADR-0027)",
};

/**
 * Zod schemas with no backend component. Same rule in the other direction.
 *
 * Note what is NOT here: a schema the backend genuinely publishes must be paired, and an unpaired one
 * appearing in this list is how a mirror silently stops being checked. Each entry says why no component
 * can exist, never merely that none does.
 */
const FRONTEND_ONLY: Record<string, string> = {
  // Pydantic inlines a base model's fields into every subclass, so the envelope is published 35 times
  // over and never as a component of its own. It is compared inside each response instead.
  BaseAPIResponse: "the envelope is inlined into every response rather than published as a component",

  // `custom.py` spells these as Annotated type aliases, not models — a JSON Schema has nowhere to put
  // a named scalar, so each is inlined at every use site and compared there.
  CustomDateString: "a Pydantic Annotated alias, inlined at each use site",
  CustomTimeString: "a Pydantic Annotated alias, inlined at each use site",
  CustomObjectIdString: "a Pydantic Annotated alias, inlined at each use site",
  ExternalUrl: "a Pydantic Annotated alias, inlined at each use site",
  // The backend's twin is `PERSON_NAME_PATTERN`, a bare `Field(pattern=...)` applied per field
  // rather than a named model, so it is published as a `pattern` keyword and never as a component.
  PersonName: "a shared validator applied per field; the backend spells it as a Field pattern",

  // Literal aliases, likewise inlined. Their members ARE compared, on every field that uses one.
  FLGruppenNames: "a Pydantic Literal alias, inlined as an enum at each use site",
  FLSaisonPhase: "a Pydantic Literal alias, inlined as an enum at each use site",
  FLSaisonStatus: "a Pydantic Literal alias, inlined as an enum at each use site",
  FLSpielerPosition: "a Pydantic Literal alias, inlined as an enum at each use site",
  FLSpielerStufe: "a Pydantic Literal alias, inlined as an enum at each use site",
  FLSpielStatus: "a Pydantic Literal alias, inlined as an enum at each use site",

  // Assembled on the client from two responses; no endpoint returns either shape.
  FLSpielplan: "composed client-side from separate responses; no endpoint returns it",
  FLSpieltagWithSpiele: "composed client-side from separate responses; no endpoint returns it",

  // Published inline at GET /teams as oneOf + discriminator rather than as a named component. Both
  // members are paired, so the union's contents are checked even though the union itself is not.
  FLTeamsResponse: "the discriminated union is published inline at GET /teams; both members are paired",

  // The same exemption one level down: a discriminated union is published inline on
  // each `teamN_quelle` property rather than as a component. Both variants are
  // paired, so every field of both is still compared.
  FLSpielQuelle: "the discriminated union is published inline on each teamN_quelle; both variants are paired",

  // And once more, on the two responses that carry a fault list. All three variants are paired, so
  // every field of every reason is still compared.
  FLBracketFault: "the discriminated union is published inline on each bracket_faults; all three variants are paired",

  // A DELETE carries its id in the path and has no request body, so these describe the server action's
  // own argument rather than anything on the wire. The reactivate POST is the same shape: an id in
  // the path, an empty body.
  FLDeleteSchiedsrichterPayload: "a DELETE takes its id from the path and has no request body",
  FLDeleteSpielortPayload: "a DELETE takes its id from the path and has no request body",
  FLDeleteTeamPayload: "a DELETE takes its id from the path and has no request body",
  FLDeleteSpielerPayload: "a DELETE takes its id from the path and has no request body",
  FLReactivateTeamPayload: "the reactivate POST takes its id from the path and has no request body",
  FLReactivateSpielerPayload: "the reactivate POST takes its id from the path and has no request body",
  // The squad junction's DELETE and reactivate share one key shape, because both address the row by
  // its natural key and neither carries a body.
  FLSaisonSpielerKeyPayload: "the junction's DELETE and reactivate take both ids from the path, with no request body",
  // The rollover is the same shape once more: `POST /saisons/{id}/activate` takes the season id from
  // the path and sends nothing, which is what makes it impossible to activate the wrong season by
  // mistyping a body field.
  FLActivateSaisonPayload: "the activate POST takes its id from the path and has no request body",
  // The matchday's DELETE and reactivate share one key shape, for the junction's reason.
  FLSpieltagKeyPayload: "the matchday's DELETE and reactivate take the id from the path, with no request body",

  // One form creates the club AND enters it into a season — a club without a junction row would be
  // invisible to every season-scoped read (backend spec I11) — so the argument spans two bodies.
  FLCreateTeamFormPayload: "the create action's own argument; the action splits it into two requests",
  // The same shape for players, and the same reason: a player without a squad row is invisible.
  FLCreateSpielerFormPayload: "the create action's own argument; the action splits it into two requests",
};

/**
 * Fields present on the frontend schema and absent from its backend twin, by pair.
 *
 * Every one of these is an id the backend reads from the PATH — RFC 5789 puts the target of a patch in
 * the request URI, so it is on no payload model.
 */
const FRONTEND_ONLY_FIELDS: Record<string, string[]> = {
  FLPatchSchiedsrichterPayload: ["id"],
  FLPatchSpielortPayload: ["id"],
  FLPatchSpielDataPayload: ["spiel_id"],
  FLPatchTeamPayload: ["id"],
  FLPatchSpielerPayload: ["id"],
  FLPatchSaisonPayload: ["id"],
  FLPatchSpieltagPayload: ["id"],
  // The season a swap belongs to is the resource being acted on, so it is the path; the two clubs are
  // the body. The control still has to know which season it is writing, hence the field here.
  FLSwapGruppenPayload: ["saison_id"],
  // The junction row is addressed by its natural key, so BOTH ids live in the request URI.
  FLPostSaisonTeamPayload: ["team_id"],
  FLPatchSaisonTeamPayload: ["team_id", "saison_id"],
  FLPostSaisonSpielerPayload: ["spieler_id"],
  FLPatchSaisonSpielerPayload: ["spieler_id", "saison_id"],
};

type JsonSchema = Record<string, unknown>;

type FieldFacts = {
  required: boolean;
  nullable: boolean;
  types: string[];
  enumValues: string[] | null;
};

function readDocument(): JsonSchema {
  try {
    return JSON.parse(readFileSync(DOCUMENT_PATH, "utf8")) as JsonSchema;
  } catch (cause) {
    throw new Error(`Could not read ${DOCUMENT_PATH}. Generate it with:  ${REGENERATE}`, { cause });
  }
}

function findSchemaModules(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findSchemaModules(full));
    else if (entry.name === "schemas.ts") found.push(full);
  }
  return found.sort();
}

function isZodSchema(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value;
}

/** Follow a JSON pointer `$ref`, with a depth cap so a malformed document cannot hang the suite. */
function deref(node: JsonSchema, root: JsonSchema): JsonSchema {
  let current = node;
  for (let hop = 0; hop < 8; hop += 1) {
    const ref = current.$ref;
    if (typeof ref !== "string" || !ref.startsWith("#/")) return current;
    let target: unknown = root;
    for (const segment of ref.slice(2).split("/")) {
      target = (target as Record<string, unknown> | undefined)?.[segment.replaceAll("~1", "/").replaceAll("~0", "~")];
    }
    if (typeof target !== "object" || target === null) return current;
    current = target as JsonSchema;
  }
  return current;
}

/**
 * `integer` collapses into `number`.
 *
 * `z.literal([0, 1])` emits `number` where Pydantic emits `integer` for the same `Literal[0, 1]`. That
 * is a spelling difference between two JSON Schema emitters, not a disagreement about the wire.
 */
function normalizeType(type: string): string {
  return type === "integer" ? "number" : type;
}

/**
 * Flatten a union into its leaves, following `$ref` on the way.
 *
 * Recursive because the two emitters nest differently: Pydantic writes one `anyOf` for `T | None`,
 * while Zod wraps a union inside the nullable's own union — `FLKontakt.telefon` arrives as an `anyOf`
 * holding an `anyOf`, and a single-level flatten reads its type as absent.
 */
function collectBranches(node: JsonSchema, root: JsonSchema, into: JsonSchema[], depth = 0): void {
  if (depth > 8) return;
  const resolved = deref(node, root);
  const nested = (resolved.anyOf ?? resolved.oneOf) as JsonSchema[] | undefined;

  if (nested) {
    for (const branch of nested) collectBranches(branch, root, into, depth + 1);
    return;
  }
  into.push(resolved);
}

function factsFor(node: JsonSchema, root: JsonSchema, required: boolean): FieldFacts {
  const branches: JsonSchema[] = [];
  collectBranches(node, root, branches);
  const types = new Set<string>();
  const enumValues = new Set<string>();
  let nullable = false;
  let sawEnum = false;

  for (const resolved of branches) {
    const declared = Array.isArray(resolved.type) ? (resolved.type as string[]) : resolved.type ? [resolved.type as string] : [];

    for (const type of declared) {
      if (type === "null") nullable = true;
      else types.add(normalizeType(type));
    }
    // An object with `properties` or `additionalProperties` and no `type` still describes an object;
    // FLGruppen's RootModel is the case that reaches this.
    if (declared.length === 0 && (resolved.properties || resolved.additionalProperties)) types.add("object");

    if (Array.isArray(resolved.enum)) {
      sawEnum = true;
      for (const member of resolved.enum as unknown[]) enumValues.add(JSON.stringify(member));
    }
    if (resolved.const !== undefined) {
      sawEnum = true;
      enumValues.add(JSON.stringify(resolved.const));
    }
  }

  return { required, nullable, types: [...types].sort(), enumValues: sawEnum ? [...enumValues].sort() : null };
}

/**
 * One object schema reduced to its fields.
 *
 * `allRequired` is the response-direction rule: FastAPI publishes the VALIDATION schema, so a field
 * carrying a default sits outside `required` even though the server always serialises it. No route sets
 * `response_model_exclude_unset`, so on a response every declared property is on the wire —
 * `acknowledged`, the three `format` discriminators and `FLTeamStatistik`'s seven counters all depend on
 * this. On a request payload a default genuinely means optional, so the rule is not applied there.
 */
function describeObject(node: JsonSchema, root: JsonSchema, allRequired: boolean): Map<string, FieldFacts> {
  const properties = (node.properties ?? {}) as Record<string, JsonSchema>;
  const required = new Set((node.required ?? []) as string[]);
  const fields = new Map<string, FieldFacts>();

  for (const [name, property] of Object.entries(properties)) {
    fields.set(name, factsFor(property, root, allRequired || required.has(name)));
  }
  return fields;
}

function responseReachable(document: JsonSchema): Set<string> {
  const components = ((document.components as JsonSchema | undefined)?.schemas ?? {}) as Record<string, JsonSchema>;
  const reached = new Set<string>();

  const collect = (value: unknown, into: Set<string>) => {
    if (Array.isArray(value)) return value.forEach((item) => collect(item, into));
    if (typeof value !== "object" || value === null) return;
    for (const [key, nested] of Object.entries(value)) {
      if (key === "$ref" && typeof nested === "string") into.add(nested.replace("#/components/schemas/", ""));
      else collect(nested, into);
    }
  };

  const frontier = new Set<string>();
  for (const operations of Object.values((document.paths ?? {}) as Record<string, Record<string, JsonSchema>>)) {
    for (const operation of Object.values(operations)) collect(operation.responses, frontier);
  }

  while (frontier.size > 0) {
    const name = frontier.values().next().value as string;
    frontier.delete(name);
    if (reached.has(name) || !components[name]) continue;
    reached.add(name);
    collect(components[name], frontier);
  }
  return reached;
}

const document = readDocument();
const components = ((document.components as JsonSchema | undefined)?.schemas ?? {}) as Record<string, JsonSchema>;
const RESPONSE_REACHABLE = responseReachable(document);

const mirrors = new Map<string, { schema: z.ZodType; module: string }>();
for (const file of findSchemaModules(SRC_DIR)) {
  const loaded: Record<string, unknown> = await import(pathToFileURL(file).href);
  for (const [name, value] of Object.entries(loaded)) {
    if (isZodSchema(value) && name.endsWith("Schema")) {
      mirrors.set(name.slice(0, -"Schema".length), { schema: value, module: path.relative(SRC_DIR, file) });
    }
  }
}

const pairs = Object.entries(components).flatMap(([component, node]) => {
  const mirror = NAME_ALIASES[component] ?? component;
  const entry = mirrors.get(mirror);
  return entry ? [{ component, node, mirror, entry }] : [];
});

// Pinned so a component quietly dropping out of the comparison is a failure rather than a smaller run.
const EXPECTED_PAIRS = 86;

describe("the published document", () => {
  it("is present and carries both sections the comparison reads", () => {
    assert.ok(Object.keys((document.paths ?? {}) as object).length > 0, `no paths in openapi.json — regenerate with: ${REGENERATE}`);
    assert.ok(Object.keys(components).length > 0, `no component schemas in openapi.json — regenerate with: ${REGENERATE}`);
  });
});

describe("every shape is paired or recorded", () => {
  it("pairs every published component with a Zod mirror, or records why none exists", () => {
    const unpaired = Object.keys(components).filter((name) => !mirrors.has(NAME_ALIASES[name] ?? name) && !(name in BACKEND_ONLY));

    assert.deepEqual(
      unpaired,
      [],
      `These backend components have no Zod mirror and no recorded reason:\n  ${unpaired.join("\n  ")}\n` +
        `Mirror each one, or add it to BACKEND_ONLY in this file with the reason no mirror can exist.`,
    );
  });

  it("pairs every Zod schema with a published component, or records why none exists", () => {
    const aliased = new Set(Object.values(NAME_ALIASES));
    const unpaired = [...mirrors.keys()].filter((name) => !(name in components) && !aliased.has(name) && !(name in FRONTEND_ONLY)).sort();

    assert.deepEqual(
      unpaired,
      [],
      `These Zod schemas have no backend component and no recorded reason:\n  ${unpaired.join("\n  ")}\n` +
        `Add it to FRONTEND_ONLY in this file with the reason no component can exist.`,
    );
  });

  it("compares the number of pairs it is meant to", () => {
    assert.equal(
      pairs.length,
      EXPECTED_PAIRS,
      `${pairs.length} pairs compared, expected ${EXPECTED_PAIRS}. If a mirror was added or removed on purpose, update EXPECTED_PAIRS.`,
    );
  });

  it("has no component reached from both a request and a response while carrying a default", () => {
    // The response-direction rule below would be ambiguous for such a component. None exists today; if
    // one appears, this says so rather than letting the comparison quietly pick a side.
    const requestReachable = new Set<string>();
    for (const operations of Object.values((document.paths ?? {}) as Record<string, Record<string, JsonSchema>>)) {
      for (const operation of Object.values(operations)) {
        JSON.stringify(operation.requestBody ?? null).replace(/#\/components\/schemas\/(\w+)/g, (_match, name: string) => {
          requestReachable.add(name);
          return _match;
        });
      }
    }

    const ambiguous = Object.entries(components)
      .filter(([name]) => RESPONSE_REACHABLE.has(name) && requestReachable.has(name))
      .filter(([, node]) => Object.values((node.properties ?? {}) as Record<string, JsonSchema>).some((p) => p.default !== undefined))
      .map(([name]) => name);

    assert.deepEqual(ambiguous, [], `Reached from both directions and carrying a default, so "always on the wire" is ambiguous: ${ambiguous}`);
  });
});

describe("each pair agrees on the wire contract", () => {
  for (const { component, node, mirror, entry } of pairs) {
    it(`${component} matches ${mirror}Schema`, () => {
      // `document`, not `components`: a `$ref` is the absolute pointer `#/components/schemas/X`, so it
      // resolves from the document root and reads as a typeless node from anywhere else.
      const backend = describeObject(node, document, RESPONSE_REACHABLE.has(component));
      const converted = z.toJSONSchema(entry.schema, { io: "output" }) as JsonSchema;
      const frontend = describeObject(converted, converted, false);

      // A `RootModel` over a constrained key map publishes `propertyNames`, not
      // `properties`, so there is no field list to compare. The backend seeds every
      // group and an omission fails the parse -- so compare the key sets instead.
      const keyEnum = (node.propertyNames as JsonSchema | undefined)?.enum as unknown[] | undefined;
      if (keyEnum && backend.size === 0) {
        assert.deepEqual(
          [...frontend.keys()].sort(),
          keyEnum.map(String).sort(),
          `${component} publishes keys [${keyEnum}] and ${mirror}Schema declares [${[...frontend.keys()]}].`,
        );
        assert.ok(
          [...frontend.values()].every((facts) => facts.required),
          `${mirror}Schema must require every key: a response omitting an empty group would fail to parse.`,
        );
        return;
      }

      const allowed = new Set(FRONTEND_ONLY_FIELDS[component] ?? []);
      const problems: string[] = [];

      for (const name of backend.keys()) {
        if (!frontend.has(name)) problems.push(`${name}: on the backend, missing from the Zod mirror`);
      }
      for (const name of frontend.keys()) {
        if (!backend.has(name) && !allowed.has(name)) problems.push(`${name}: in the Zod mirror, not published by the backend`);
      }

      for (const [name, expected] of backend) {
        const actual = frontend.get(name);
        if (!actual) continue;
        if (expected.required !== actual.required)
          problems.push(`${name}: required=${expected.required} on the backend, ${actual.required} in Zod`);
        if (expected.nullable !== actual.nullable)
          problems.push(`${name}: nullable=${expected.nullable} on the backend, ${actual.nullable} in Zod`);
        if (expected.types.join() !== actual.types.join())
          problems.push(`${name}: type [${expected.types}] on the backend, [${actual.types}] in Zod`);
        if ((expected.enumValues ?? []).join() !== (actual.enumValues ?? []).join()) {
          problems.push(`${name}: enum [${expected.enumValues ?? "none"}] on the backend, [${actual.enumValues ?? "none"}] in Zod`);
        }
      }

      assert.deepEqual(
        problems,
        [],
        `${component} and ${mirror}Schema (${mirrors.get(mirror)!.module}) disagree:\n  ${problems.join("\n  ")}\n` +
          `Change both sides in the same commit, then refresh the document:  ${REGENERATE}`,
      );
    });
  }
});
