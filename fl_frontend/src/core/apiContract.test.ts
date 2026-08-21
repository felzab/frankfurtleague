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
 * Backend component name → the frontend export mirroring it, where the two names differ.
 *
 * An alias keeps a pair CHECKED; listing one as an exception instead would silently drop a real
 * mirror out of the comparison.
 */
const NAME_ALIASES: Record<string, string> = {
  // Named for the function that returns them, the frontend's convention for a query's return type.
  CheckIsLiveResponse: "CheckIsLiveReturn",
  CheckIsReadyResponse: "CheckIsReadyReturn",
  SystemInfoResponse: "GetSystemInfoReturn",

  // Only the joined shape reaches the wire; the frontend parses no stored document, so it has one.
  FLSpielJoined: "FLSpiel",
};

/**
 * Components with no Zod mirror. A new backend response model fails the pairing test until it is
 * mirrored or written here, which is why the list is kept by hand.
 */
const BACKEND_ONLY: Record<string, string> = {
  HTTPValidationError: "FastAPI's validation error body; thrown on any non-2xx before a schema parses it",
  ValidationError: "FastAPI's validation error body; thrown on any non-2xx before a schema parses it",

  FLSchiedsrichterSingleResponse: "GET /{id} exists for uniform addressability and has no caller",
  FLSpielorteSingleResponse: "GET /{id} exists for uniform addressability and has no caller",
};

/**
 * Zod schemas with no backend component. Each entry says why no component CAN exist, never merely
 * that none does — an entry for a schema the backend publishes silently stops checking that mirror.
 */
const FRONTEND_ONLY: Record<string, string> = {
  BaseAPIResponse: "the envelope is inlined into every response rather than published as a component",

  CustomDateString: "a Pydantic Annotated alias, inlined at each use site",
  CustomTimeString: "a Pydantic Annotated alias, inlined at each use site",
  CustomObjectIdString: "a Pydantic Annotated alias, inlined at each use site",
  ExternalUrl: "a Pydantic Annotated alias, inlined at each use site",
  PersonName: "a shared validator applied per field; the backend spells it as a Field pattern",

  FLGruppenNames: "a Pydantic Literal alias, inlined as an enum at each use site",
  FLSaisonPhase: "a Pydantic Literal alias, inlined as an enum at each use site",
  FLSonderereignis: "a Pydantic Literal alias, inlined as an enum at each use site",
  FLSaisonStatus: "a Pydantic Literal alias, inlined as an enum at each use site",
  FLSpielerPosition: "a Pydantic Literal alias, inlined as an enum at each use site",
  FLSpielerStufe: "a Pydantic Literal alias, inlined as an enum at each use site",
  FLSpielStatus: "a Pydantic Literal alias, inlined as an enum at each use site",

  FLSpielplan: "composed client-side from separate responses; no endpoint returns it",
  FLSpieltagWithSpiele: "composed client-side from separate responses; no endpoint returns it",

  FLSpielTeamField: "no endpoint touches the stored side: a read serves FLSpielTeamFieldJoined and a write takes FLSpielTeamFieldPayload",

  FLTeamsResponse: "the discriminated union is published inline at GET /teams; both members are paired",

  FLSpielQuelle: "the discriminated union is published inline on each teamN_quelle; both variants are paired",

  FLBracketFault: "the discriminated union is published inline on each bracket_faults; all five variants are paired",

  FLDeleteTeamPayload: "a DELETE takes its id from the path and has no request body",
  FLDeleteSpielerPayload: "a DELETE takes its id from the path and has no request body",
  FLReactivateTeamPayload: "the reactivate POST takes its id from the path and has no request body",
  FLReactivateSpielerPayload: "the reactivate POST takes its id from the path and has no request body",
  FLSaisonSpielerKeyPayload: "the junction's DELETE and reactivate take both ids from the path, with no request body",
  FLActivateSaisonPayload: "the activate POST takes its id from the path and has no request body",
  FLGenerateSpielplanPayload: "the Spielplan POST takes its id from the path and has no request body",
  FLSchiedsrichterKeyPayload: "the referee's DELETE and reactivate take the id from the path, with no request body",
  FLSpielortKeyPayload: "the venue's DELETE and reactivate take the id from the path, with no request body",

  // One form creates the row and its junction: without one it is invisible — backend spec I11 for a
  // club, I33 for a player.
  FLCreateTeamFormPayload: "the create action's own argument; the action splits it into two requests",
  FLCreateSpielerFormPayload: "the create action's own argument; the action splits it into two requests",
};

/**
 * Fields on the frontend schema and absent from its backend twin, by pair. Every one is an id the
 * backend reads from the PATH — RFC 5789 puts a patch's target in the URI, so no payload carries it.
 */
const FRONTEND_ONLY_FIELDS: Record<string, string[]> = {
  FLPatchSchiedsrichterPayload: ["id"],
  FLPatchSpielortPayload: ["id"],
  FLPatchSpielDataPayload: ["spiel_id"],
  FLPatchTeamPayload: ["id"],
  FLPatchSpielerPayload: ["id"],
  FLPatchSaisonPayload: ["id"],
  FLPatchSpieltagPayload: ["id"],
  // The season is the resource acted on, so it is the path; the control still has to know which.
  FLSwapGruppenPayload: ["saison_id"],
  // A junction row is addressed by its natural key, so BOTH ids live in the request URI.
  FLPostSaisonTeamPayload: ["team_id"],
  FLPatchSaisonTeamPayload: ["team_id", "saison_id"],
  FLPostSaisonSpielerPayload: ["spieler_id"],
  FLPatchSaisonSpielerPayload: ["spieler_id", "saison_id"],
};

type JsonSchema = Record<string, unknown>;

/**
 * The whole of what is compared. Patterns, lengths, bounds and messages diverge by design, and
 * comparing validation policy produces failures nobody can act on.
 */
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

/** Depth-capped, so a malformed document cannot hang the suite. */
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
 * `integer` collapses into `number`: the two emitters spell the same `Literal[0, 1]` differently,
 * which is not a disagreement about the wire.
 */
function normalizeType(type: string): string {
  return type === "integer" ? "number" : type;
}

/**
 * Recursive because the emitters nest differently: Zod wraps a union inside the nullable's own
 * union, and a single-level flatten reads the inner `anyOf`'s type as absent.
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
    // `properties` or `additionalProperties` with no `type` still describes an object.
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
 * `allRequired` is the response-direction rule: FastAPI publishes the VALIDATION schema, so a field
 * with a default sits outside `required` although the server always serialises it. On a request a
 * default does mean optional.
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
const EXPECTED_PAIRS = 98;

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

  // Both lists rot the other way too: a component that gains a mirror, or a schema that gains a
  // component, leaves an exemption nothing reports. One sat here unnoticed until an audit read it.
  it("carries no exemption the pairing has since made unnecessary", () => {
    const deadBackend = Object.keys(BACKEND_ONLY)
      .filter((name) => !(name in components) || mirrors.has(NAME_ALIASES[name] ?? name))
      .sort();
    const deadFrontend = Object.keys(FRONTEND_ONLY)
      .filter((name) => !mirrors.has(name) || name in components)
      .sort();

    assert.deepEqual(
      deadBackend,
      [],
      `These BACKEND_ONLY entries are dead -- the component is gone, or it now has a mirror:\n  ${deadBackend.join("\n  ")}`,
    );
    assert.deepEqual(
      deadFrontend,
      [],
      `These FRONTEND_ONLY entries are dead -- the schema is gone, or it now has a component:\n  ${deadFrontend.join("\n  ")}`,
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
    // The response-direction rule would be ambiguous for such a component, so fail rather than
    // letting the comparison quietly pick a side.
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
      // `document`, not `components`: a `$ref` is absolute, so it resolves only from the root.
      const backend = describeObject(node, document, RESPONSE_REACHABLE.has(component));
      const converted = z.toJSONSchema(entry.schema, { io: "output" }) as JsonSchema;
      const frontend = describeObject(converted, converted, false);

      // A `RootModel` over a constrained key map publishes `propertyNames` and no field list, so
      // compare the key sets instead.
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
