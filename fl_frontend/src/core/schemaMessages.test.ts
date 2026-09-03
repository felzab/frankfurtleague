import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import z from "zod";

import { filesUnder } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/** Every `schemas.ts` under `src`, the same set `apiContract.test.ts` walks. */
const findSchemaModules = (dir: string): string[] => filesUnder(dir, (name) => name === "schemas.ts", 8).sort();

function isZodSchema(value: unknown): value is z.ZodType {
  return typeof value === "object" && value !== null && "_zod" in value;
}

const schemas = new Map<string, z.ZodType>();
for (const file of findSchemaModules(SRC_DIR)) {
  const loaded: Record<string, unknown> = await import(pathToFileURL(file).href);
  for (const [name, value] of Object.entries(loaded)) {
    if (isZodSchema(value) && name.endsWith("Schema")) schemas.set(name, value);
  }
}

type JsonSchema = { enum?: unknown[]; const?: unknown; [key: string]: unknown };

/** The published shape, or `null` where a schema cannot be represented (a transform, say). */
function asJson(schema: z.ZodType): JsonSchema | null {
  try {
    return z.toJSONSchema(schema, { io: "input" }) as JsonSchema;
  } catch {
    return null;
  }
}

/** Every closed set anywhere in a tree, each as a stable signature of its members. */
function closedSetsIn(node: unknown, into: Set<string>, depth = 0): void {
  if (depth > 12 || typeof node !== "object" || node === null) return;

  const shape = node as JsonSchema;
  if (Array.isArray(shape.enum)) into.add(JSON.stringify([...shape.enum].sort()));
  if (shape.const !== undefined) into.add(JSON.stringify([shape.const]));

  for (const child of Object.values(shape)) {
    if (Array.isArray(child)) for (const item of child) closedSetsIn(item, into, depth + 1);
    else closedSetsIn(child, into, depth + 1);
  }
}

/**
 * Every closed set a WRITE payload binds. A message on one of these can reach the person filling the
 * form in; a message on a read model's own enum can only ever reach a parse failure.
 */
const payloadSets = new Set<string>();
for (const [name, schema] of schemas) {
  if (!name.endsWith("PayloadSchema")) continue;
  const json = asJson(schema);
  if (json !== null) closedSetsIn(json, payloadSets);
}

/** The alias schemas that ARE a closed set, paired with the members they publish. */
const closedAliases = [...schemas].flatMap(([name, schema]) => {
  const json = asJson(schema);
  if (json === null) return [];

  const members = Array.isArray(json.enum) ? json.enum : json.const !== undefined ? [json.const] : null;
  return members === null ? [] : [{ name, schema, members, signature: JSON.stringify([...members].sort()) }];
});

const boundToAForm = closedAliases.filter((alias) => payloadSets.has(alias.signature));

/** A value no closed set here contains, so parsing it always produces the set's own refusal. */
const NOT_A_MEMBER = "__kein_mitglied__";

/** What Zod itself would say about the same set, computed rather than quoted so an upgrade cannot stale it. */
function libraryDefaultFor(members: unknown[]): string | null {
  const twin = members.length === 1 ? z.literal(members[0] as string) : z.enum(members as [string, ...string[]]);
  const parsed = twin.safeParse(NOT_A_MEMBER);

  return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
}

function messageFor(schema: z.ZodType): string | null {
  const parsed = schema.safeParse(NOT_A_MEMBER);

  return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
}

describe("what a closed set says when it refuses", () => {
  /* First, and per set rather than in total: a walk that stopped resolving would examine nothing and
     report nothing, which is the one failure a coverage test must not have. */
  it("found the schemas, the payload sets and the aliases it compares", () => {
    assert.ok(schemas.size >= 100, `expected at least 100 schema exports, found ${String(schemas.size)}`);
    assert.ok(payloadSets.size >= 8, `expected at least 8 closed sets reachable from a payload, found ${String(payloadSets.size)}`);
    assert.ok(boundToAForm.length >= 6, `expected at least 6 form-bound closed sets, found ${String(boundToAForm.length)}`);
  });

  /**
   * Zod's own answer lists the wire's slugs — a sentence about the API, shown to somebody filling in
   * a form. The default is COMPUTED from a bare twin rather than quoted, so a Zod reword cannot turn
   * this green on its own.
   */
  for (const alias of boundToAForm) {
    it(`${alias.name} answers in the product's own words`, () => {
      const own = messageFor(alias.schema);
      assert.ok(own !== null, `${alias.name} accepted a value that is in no closed set, so nothing was compared`);

      assert.notEqual(own, libraryDefaultFor(alias.members), `${alias.name} falls back to Zod's default, which enumerates the slugs`);

      /* The second shape the same defect takes: a message that IS custom and still addresses a
         developer. One names its own type, which no sentence written for a reader ever does. */
      const typeName = alias.name.replace(/Schema$/, "");
      assert.ok(!own.includes(typeName), `${alias.name} answers with its own type name, which is a note to a developer`);

      /* The third, and the one the two checks above let through: `enum member expected` is neither
         Zod's wording nor its own type name. What separates copy from a note is exact and cheap —
         copy is a SENTENCE. This proves shape, never language (`docs/frontend/spec.md` §4). */
      assert.match(own, /^[A-ZÄÖÜ]/u, `${alias.name} answers with a fragment rather than a sentence: "${own}"`);
      assert.match(own, /\.$/u, `${alias.name} answers without a full stop, which is a note rather than a sentence: "${own}"`);
    });
  }
});
