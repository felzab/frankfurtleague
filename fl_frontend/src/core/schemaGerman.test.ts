import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import z from "zod";

import { openingTag } from "@/core/openingTag.ts";
import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

/**
 * Zod's own wording, which is English. Matched rather than the German it replaces: a field MISSING its sentence
 * is exactly the one an `error:`-shaped search cannot find, so the sweep looks for the fallback instead.
 */
const ZOD_DEFAULT = /^(Invalid input|Invalid option|Invalid key|Too small|Too big|Unrecognized|Required|Expected)/i;

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/** Every `schemas.ts` under `features/`, discovered on disk — the same route `apiContract.test.ts` takes. */
const findSchemaModules = (dir: string): string[] => filesUnder(dir, (name) => name === "schemas.ts", 8);

/**
 * Every payload schema in the app, found by walking the modules rather than by naming them: a hand-written list
 * is one more place a new schema can be forgotten, and a forgotten schema is exactly the one still in English.
 */
const BOUND: Record<string, unknown> = {};
for (const file of findSchemaModules(path.join(SRC_DIR, "features"))) {
  const loaded: Record<string, unknown> = await import(pathToFileURL(file).href);
  for (const [name, value] of Object.entries(loaded)) {
    const candidate = value as { safeParse?: unknown; def?: { shape?: unknown } };
    if (typeof candidate?.safeParse === "function" && candidate.def?.shape !== undefined && name.endsWith("PayloadSchema")) {
      BOUND[`${path.relative(SRC_DIR, file).split(path.sep).join("/")} :: ${name}`] = value;
    }
  }
}

type Shaped = { def?: { shape?: Record<string, unknown>; type?: string; innerType?: unknown; options?: unknown[]; element?: unknown } };

/** No closed set in this product holds it, so every one of them must refuse it — in German. */
const OUTSIDE_THE_SET = "__kein_mitglied__";

/**
 * The emptiness this field's own control writes, which is `isAbsent`'s set. Probing every field with `null`
 * would grade a value no control can produce and report a message no reader is ever shown.
 */
function emptyFor(schema: unknown): unknown {
  const def = (schema as Shaped).def;
  if (def?.type === "nullable" || def?.type === "optional") return emptyFor(def.innerType);

  switch (def?.type) {
    case "number":
    case "int":
      return null;
    case "string":
      return "";
    case "boolean":
      return false;
    case "array":
      return [];
    // A closed set has no empty value, so the wrong input is one OUTSIDE it — which is also what makes Zod
    // quote the members back. Inline sets are the ones no alias sweep can reach, and there are more of them
    // than aliased ones.
    case "enum":
    case "literal":
      return OUTSIDE_THE_SET;
    // A discriminated union answers on its discriminator, which is a closed set spelled another way.
    case "union":
      return {};
    default:
      return undefined;
  }
}

/**
 * One graded probe. A union member carries its OWN root: a value under a discriminator is unreachable by
 * setting one path on the outer object, the discriminator failing first.
 */
type Probe = { root: unknown; rootId: string; path: string; wrong: unknown };

/** `nullable`, `optional` and `default` wrap the thing that actually carries the shape. */
function unwrap(schema: unknown): unknown {
  const def = (schema as Shaped).def;
  if (def?.type === "nullable" || def?.type === "optional" || def?.type === "default") return unwrap(def.innerType);

  return schema;
}

/** Walks the schema's own shape, so a field is found because it EXISTS rather than because of how it is written. */
function leafPaths(schema: unknown, prefix = "", root: unknown = schema, rootId = ""): Probe[] {
  const inner = unwrap(schema);
  const def = (inner as Shaped).def;

  if (def?.shape !== undefined) {
    return Object.keys(def.shape).flatMap((key) =>
      leafPaths(def.shape?.[key], prefix === "" ? key : `${prefix}.${key}`, prefix === "" ? inner : root, rootId),
    );
  }

  // The union is itself a closed set at this path — its discriminator — and each member carries its own fields.
  // Each member is identified separately: both spell `type`, and one id would grade only the first of them.
  if (def?.type === "union" && Array.isArray(def.options)) {
    return [
      { root, rootId, path: prefix, wrong: {} },
      ...def.options.flatMap((option, index) => leafPaths(option, "", option, `${rootId}${prefix}[${String(index)}]`)),
    ];
  }

  // The element keeps the array's path with an index under it: an array of SCALARS carries no field
  // name of its own, so a path restarted here leaves that payload judged by nothing.
  if (def?.type === "array" && def.element !== undefined) return leafPaths(def.element, prefix === "" ? "0" : `${prefix}.0`, root, rootId);

  return prefix === "" ? [] : [{ root, rootId, path: prefix, wrong: emptyFor(inner) }];
}

function setAt(target: Record<string, unknown>, path: string[], value: unknown): void {
  const [head, ...rest] = path;
  if (head === undefined) return;
  if (rest.length === 0) {
    target[head] = value;
    return;
  }
  // An array wherever the next segment is an index: an object standing in for one fails the type
  // check first, and the element's own message is never reached.
  target[head] ??= /^\d+$/.test(rest[0] ?? "") ? [] : {};
  setAt(target[head] as Record<string, unknown>, rest, value);
}

describe("what the walker reads off a schema", () => {
  it("keeps the array's path under an index, so an array of scalars still yields a leaf", () => {
    const probes = leafPaths(z.object({ bewerbung_ids: z.array(z.string()) }));

    assert.deepEqual(
      probes.map((probe) => probe.path),
      ["bewerbung_ids.0"],
    );
  });

  it("finds nothing where a schema carries no field, which is the state the floor below refuses", () => {
    assert.deepEqual(leafPaths(z.object({})), []);
  });
});

describe("what a bound schema says when a field is emptied", () => {
  for (const [name, schema] of Object.entries(BOUND)) {
    const probes = leafPaths(schema);

    it(`${name} has fields to judge`, () => {
      // Anti-vacuity: a walker that stopped descending would leave every case below true of no paths.
      assert.ok(probes.length > 0, `${name} produced no leaf paths, so the sweep judged nothing`);
    });

    const seen = new Set<string>();
    for (const { root, rootId, path, wrong } of probes) {
      // Only what a control can leave behind, or — for a closed set — a value outside it. `undefined` here
      // means a shape neither applies to. The key dedupes the same leaf reached through two union members.
      if (wrong === undefined || path === "") continue;
      const key = `${rootId}/${path}:${String(wrong)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      it(`${name}.${rootId}${path} answers a wrong value in German`, () => {
        // A message only on a `.positive()` or `.min()` bound leaves Zod's English on the TYPE check, which
        // is the one an empty field hits first. A closed set answers by quoting its own slugs.
        const payload: Record<string, unknown> = {};
        setAt(payload, path.split("."), wrong);
        const result = (
          root as { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } }
        ).safeParse(payload);
        if (result.success || result.error === undefined) return;

        for (const issue of result.error.issues) {
          if (issue.path.join(".") !== path) continue;
          assert.doesNotMatch(issue.message, ZOD_DEFAULT, `${name}.${path} shows Zod's English: "${issue.message}"`);
        }
      });
    }
  }
});

const TAG = /<[A-Za-z][\w.]*/g;
// The mark as a bare attribute: the tag carries its own `>`, so a boundary of whitespace alone
// would lose `<X name="a" isRequired>`.
const MARK = /\bisRequired(?![\w=])/;
const LITERAL_NAME = /\bname="([^"]*)"/;
/** A name built from one prop and a literal tail, which is `AddressFields`'s five controls. */
const COMPUTED_NAME = /\bname=\{`\$\{(\w+)\}([^`${]*)`\}/;

/**
 * A required control, read off ONE opening tag so `isRequired` and its `name` belong to the same
 * control (`docs/frontend/spec.md :: I17`). A conditional `isRequired` is out of reach.
 */
function requiredNamesIn(source: string, resolve: (identifier: string) => readonly string[]): string[] {
  const found: string[] = [];

  for (const tag of source.matchAll(TAG)) {
    const opening = openingTag(source, tag.index);
    if (!MARK.test(opening)) continue;

    const literal = LITERAL_NAME.exec(opening);
    if (literal?.[1] !== undefined) {
      found.push(literal[1]);
      continue;
    }

    // Dropped rather than guessed at: a name paired with a path no control writes fails a branch
    // that touched neither the control nor the schema.
    const computed = COMPUTED_NAME.exec(opening);
    if (computed?.[1] === undefined || computed[2] === undefined) continue;
    for (const prefix of resolve(computed[1])) found.push(`${prefix}${computed[2]}`);
  }
  return found;
}

const collectComponents = (dir: string): string[] => filesUnder(dir, (name) => name.endsWith(".tsx") && !isTestFile(name), 200);

const COMPONENTS = new Map(collectComponents(SRC_DIR).map((file) => [file, readFileSync(file, "utf8")]));

/** Every value a prop holds where a `name` is built from it, resolved from the tree rather than listed. */
function propValues(file: string, identifier: string): string[] {
  const text = COMPONENTS.get(file) ?? "";
  const component = /export function (\w+)\s*\(/.exec(text)?.[1];
  const declared = new RegExp(String.raw`\n\s{2}` + identifier + String.raw`(?:\s*=\s*"([^"]*)")?,`).exec(text);
  if (component === undefined || declared === null) return [];

  const fallback = declared[1];
  const literal = new RegExp(String.raw`\b` + identifier + String.raw`="([^"]*)"`);
  const expression = new RegExp(String.raw`\b` + identifier + String.raw`=\{`);
  const values: string[] = [];

  for (const [other, otherText] of COMPONENTS) {
    if (other === file) continue;

    for (const site of otherText.matchAll(new RegExp(String.raw`<` + component + String.raw`\b`, "g"))) {
      const tag = openingTag(otherText, site.index);
      const passed = literal.exec(tag);

      if (passed?.[1] !== undefined) values.push(passed[1]);
      // The default only where a site leaves the prop off, and nothing where one passes an
      // expression: a default every site overrides names a path no form writes.
      else if (!expression.test(tag) && fallback !== undefined) values.push(fallback);
    }
  }
  return [...new Set(values)];
}

/** Every path some form marks required, discovered from the forms rather than listed beside them. */
const REQUIRED_NAMES = new Set([...COMPONENTS].flatMap(([file, text]) => requiredNamesIn(text, (identifier) => propValues(file, identifier))));

/** One schema's path that a form marks required, with the emptiness that field's own control writes. */
const marked = Object.entries(BOUND).flatMap(([name, schema]) =>
  leafPaths(schema)
    .filter((probe) => probe.rootId === "" && probe.wrong !== undefined && REQUIRED_NAMES.has(probe.path))
    .map((probe) => ({ schema: name, root: probe.root, path: probe.path, wrong: probe.wrong })),
);

describe("what a schema does with a field its form marks required", () => {
  it("reads a mark off the control that carries it, and off no other", () => {
    /* The reader on input, not on the tree: a discovery that silently finds nothing passes every case
       below, and no count over uniform marks can tell a correct reader from a truncating one. */
    const sample = [
      '<TextField isRequired name="vorname">',
      '<TextField name="stadtteil">',
      '<NumberField name="kader.gute_spieler" isRequired minValue={0}>',
      '<TextField isRequired name={path("nachname")}>',
      '<TextField isRequired={isNeu} name="schule.shorthand">',
      '<TextField isRequired>Trag den name="verborgen" ein</TextField>',
      '<TextField onChange={(next) => set(next)} isRequired name="vorname">',
      "<TextField isRequired name={`${namePrefix}.strasse`}>",
      "<TextField isRequired name={`${ungelesen}.plz`}>",
    ].join("\n");

    // Twice over for `vorname`: the arrow's own `>` truncated the second one, and a set would have
    // hidden the loss behind the first.
    assert.deepEqual(
      requiredNamesIn(sample, (identifier) => (identifier === "namePrefix" ? ["address", "schule.address"] : [])),
      ["vorname", "kader.gute_spieler", "vorname", "address.strasse", "schule.address.strasse"],
    );
  });

  it("found the marks and the schema paths they land on", () => {
    // Floors, because a walk that stopped resolving would leave every case below true of nothing.
    assert.ok(REQUIRED_NAMES.size >= 20, `expected at least 20 paths marked required, found ${String(REQUIRED_NAMES.size)}`);
    assert.ok(marked.length >= 60, `expected at least 60 schema paths carrying a mark, found ${String(marked.length)}`);
  });

  for (const { schema, root, path: fieldPath, wrong } of marked) {
    it(`${schema}.${fieldPath} refuses the emptiness its control writes`, () => {
      /* The mark and the schema are two halves of one promise. A field that keeps its asterisk and
         stops refusing takes the whole promise with it, and every other guard on this branch stays
         green: the message sweeps grade a refusal that no longer happens. */
      const payload: Record<string, unknown> = {};
      setAt(payload, fieldPath.split("."), wrong);
      const result = (root as { safeParse: (v: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[] }[] } } }).safeParse(
        payload,
      );

      const refused = !result.success && (result.error?.issues ?? []).some((issue) => issue.path.join(".") === fieldPath);
      assert.ok(refused, `${schema} accepts ${JSON.stringify(wrong)} at \`${fieldPath}\`, which its form marks required`);
    });
  }
});
