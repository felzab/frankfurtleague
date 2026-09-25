import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import z from "zod";

import { sources } from "@/core/actionSources.ts";
import { blankComments } from "@/core/blankComments.ts";
import { openingTag } from "@/core/openingTag.ts";
import { schemaModules } from "@/core/schemaModules.ts";
import { isTestFile } from "@/core/treeWalk.ts";

/**
 * Zod's own wording, which is English. Matched rather than the German it replaces: a field MISSING its sentence
 * is exactly the one an `error:`-shaped search cannot find, so the sweep looks for the fallback instead.
 */
const ZOD_DEFAULT = /^(Invalid input|Invalid option|Invalid key|Too small|Too big|Unrecognized|Required|Expected)/i;

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/**
 * Every payload schema in the app, found by walking the modules rather than by naming them: a hand-written list
 * is one more place a new schema can be forgotten, and a forgotten schema is exactly the one still in English.
 */
const BOUND: Record<string, unknown> = {};
for (const { module, exports } of await schemaModules(path.join(SRC_DIR, "features"))) {
  for (const [name, value] of Object.entries(exports)) {
    const candidate = value as { safeParse?: unknown; def?: { shape?: unknown } };
    if (typeof candidate?.safeParse === "function" && candidate.def?.shape !== undefined && name.endsWith("PayloadSchema")) {
      BOUND[`${module} :: ${name}`] = value;
    }
  }
}

type Shaped = { def?: { shape?: Record<string, unknown>; type?: string; innerType?: unknown; options?: unknown[]; element?: unknown } };

/** No closed set in this product holds it, so every one of them must refuse it — in German. */
const OUTSIDE_THE_SET = "__kein_mitglied__";

/**
 * The emptiness this field's own control writes, which is `isAbsent`'s set. Probing a NON-nullable leaf
 * with `null` would grade a value no control can produce; a nullable one's `null` is `leafPaths`'s own
 * probe beside this.
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
type Probe = { root: unknown; rootId: string; path: string; wrong: unknown; cleared: boolean };

type Parsed = { safeParse: (value: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[]; message: string }[] } } };

/** `nullable`, `optional` and `default` wrap the thing that actually carries the shape. */
function unwrap(schema: unknown): unknown {
  const def = (schema as Shaped).def;
  if (def?.type === "nullable" || def?.type === "optional" || def?.type === "default") return unwrap(def.innerType);

  return schema;
}

/** Whether a leaf can be handed `null` at all, which is the only place a cleared picker's value lands. */
function admitsNull(schema: unknown): boolean {
  const def = (schema as Shaped).def;
  if (def?.type === "nullable") return true;

  // `undefined` is not `null`, so neither wrapper admits one by itself — only the `nullable` one of
  // them a chain may hold further in.
  return (def?.type === "optional" || def?.type === "default") && admitsNull(def.innerType);
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
      { root, rootId, path: prefix, wrong: {}, cleared: false },
      ...def.options.flatMap((option, index) => leafPaths(option, "", option, `${rootId}${prefix}[${String(index)}]`)),
    ];
  }

  // The element keeps the array's path with an index under it: an array of SCALARS carries no field
  // name of its own, so a path restarted here leaves that payload judged by nothing.
  if (def?.type === "array" && def.element !== undefined) return leafPaths(def.element, prefix === "" ? "0" : `${prefix}.0`, root, rootId);

  if (prefix === "") return [];

  // Both values where the leaf admits `null`: a cleared PICKER writes that, a cleared BOX writes the
  // inner type's own emptiness, and a leaf graded on one of them leaves the other's control
  // promising a refusal nothing checked.
  const empty = emptyFor(inner);
  const emptied = { root, rootId, path: prefix, wrong: empty, cleared: false };

  return admitsNull(schema) && empty !== null ? [emptied, { root, rootId, path: prefix, wrong: null, cleared: true }] : [emptied];
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

  it("probes a nullable leaf with the null a cleared control writes, beside the type's own emptiness", () => {
    /* The two are written by different controls — a cleared picker and a cleared box — and a leaf
       graded on one of them leaves the other's control promising a refusal nothing checked. */
    assert.deepEqual(
      leafPaths(z.object({ datum: z.string().nullable(), name: z.string(), anzahl: z.number().nullable() })).map(({ path, wrong, cleared }) => [
        path,
        wrong,
        cleared,
      ]),
      [
        ["datum", "", false],
        ["datum", null, true],
        ["name", "", false],
        // One probe where the type's own emptiness IS `null`: a second would grade the same value twice.
        ["anzahl", null, false],
      ],
    );
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
    for (const { root, rootId, path, wrong, cleared } of probes) {
      // A nullable leaf admits `null` by construction, so a case here could only ever speak for a
      // refinement a payload carrying one field never reaches. `marked` is where that probe answers.
      if (cleared) continue;

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
// would lose `<X name="a" isRequired>`. The braces are `carriesMark`'s depth tokens, and the
// literal arm is what survives its count.
const MARK = /[{}]|\bisRequired(?![\w=])|\bisRequired=\{\s*true\s*\}/g;
const LITERAL_NAME = /\bname="([^"]*)"/;
/** A name a template composes around one prop hole, wherever in the path that hole sits. */
const TEMPLATE_NAME = /\bname=\{`([^`${]*)\$\{(\w+)\}([^`${]*)`\}/;
/** A name a local one-argument builder composes, which is `FormKontaktpersonenSection`'s `path`. */
const BUILT_NAME = /\bname=\{(\w+)\("([^"]*)"\)\}/;
/** A `name` handed straight on from a prop, whose path every call site of this control writes. */
const BARE_NAME = /\bname=\{(\w+)\}/;
/** A `name` this control does not fix itself, its path being written wherever the control is used. */
const OWN_PATH = /\bname=(?!\{\w+\})/;
/** Any `name` at all, which separates a site handing one over from one leaving the control's own. */
const ANY_NAME = /\bname=/;

/**
 * A props spread in attribute position, which hands the control a `name` no pattern above can read.
 * Depth-counted: the spread inside an `onChange` arrow builds state rather than props.
 */
function carriesSpread(opening: string): boolean {
  let depth = 0;

  for (let at = 0; at < opening.length; at++) {
    if (opening[at] === "{") {
      depth += 1;
      if (depth === 1 && /^\{\s*\.\.\./.test(opening.slice(at))) return true;
    } else if (opening[at] === "}") depth -= 1;
  }

  return false;
}

/**
 * Depth-counted as `carriesSpread` is: a control forwarding `isRequired={isRequired}` leaves the
 * mark to its call sites, and read as a mark here it promises every site's path whether that site
 * asked for one or not.
 */
function carriesMark(opening: string): boolean {
  let depth = 0;

  for (const token of opening.matchAll(MARK)) {
    if (token[0] === "{") depth += 1;
    else if (token[0] === "}") depth -= 1;
    else if (depth === 0) return true;
  }

  return false;
}

/**
 * The segment a form fills at run time.
 *
 * A hole inside a path is closed by the schema's keys at that position; a hole that IS the prefix
 * stands for any depth, and only a call site closes it.
 */
const SEGMENT = "*";

/** The template a local one-argument arrow returns, with the call's own argument in its hole. */
function builderTemplate(source: string, identifier: string, argument: string): string | null {
  const declared = new RegExp(String.raw`\b` + identifier + String.raw`\s*=\s*\((\w+)[^)]*\)\s*=>\s*` + "`([^`]*)`").exec(source);
  if (declared?.[1] === undefined || declared[2] === undefined) return null;

  return declared[2].split("${" + declared[1] + "}").join(argument);
}

/** Every path one template can name: the values a call site fixes, or the segment the schema closes. */
function namesFromTemplate(template: string, resolve: (identifier: string, at: number) => readonly string[], at: number): string[] {
  const hole = /^([^`${]*)\$\{(\w+)\}([^`${]*)$/.exec(template);
  if (hole === null) return template.includes("${") ? [] : [template];

  const [, head = "", identifier = "", tail = ""] = hole;

  return head === "" ? resolve(identifier, at).map((value) => `${value}${tail}`) : [`${head}${SEGMENT}${tail}`];
}

/** The path a control fixes for a site handing it none: its own `name` default, credited only where that default reaches a `name` attribute. */
function fixedNameOf(tree: ReadonlyMap<string, string>, component: string): string[] {
  const declares = new RegExp(String.raw`export function ` + component + String.raw`\s*\(`);

  for (const text of tree.values()) {
    const declared = declares.exec(text);
    if (declared === null) continue;

    // The declared component's own body, never the file's, as `propValues` reads it: a module
    // holding two lends the first one the second's default otherwise.
    const body = enclosingComponent(text, declared.index)?.body ?? "";
    // Both halves, never the default alone: a control with an unrelated `name` prop would otherwise
    // lend its default to a mark that names no field at all.
    const fixed = /[,{]\s*name\s*=\s*"([^"]*)"\s*[,}]/.exec(body);

    return fixed?.[1] !== undefined && /\bname=\{name\}/.test(body) ? [fixed[1]] : [];
  }

  return [];
}

/**
 * Every path a required control names, and every marked control this reader could not place
 * (`docs/frontend/spec.md :: I17`). A conditional `isRequired` is out of reach.
 */
function requiredNamesIn(
  raw: string,
  resolve: (identifier: string, at: number) => readonly string[],
  fixes: (component: string) => readonly string[],
): { names: string[]; unread: string[] } {
  const names: string[] = [];
  const unread: string[] = [];
  // A comment between two attributes holds a `<` at brace depth zero, which leaves `openingTag` with
  // nothing to return and the control it stood in marked by nothing.
  const source = blankComments(raw);

  for (const tag of source.matchAll(TAG)) {
    const opening = openingTag(source, tag.index);
    // Reported before the mark is looked for, never after: an empty span carries no `isRequired` for
    // the test below to find, so a marked control behind a lost brace count leaves in silence.
    if (opening === "") {
      unread.push(source.slice(tag.index).split("\n")[0] ?? "");
      continue;
    }
    if (!carriesMark(opening)) continue;

    const literal = LITERAL_NAME.exec(opening);
    if (literal?.[1] !== undefined) {
      names.push(literal[1]);
      continue;
    }

    const built = BUILT_NAME.exec(opening);
    const template = TEMPLATE_NAME.exec(opening);
    // A bare prop is a template with nothing around its hole, so one reader answers both: the path
    // is written at each call site either way, and `resolve` is what reads those sites.
    const bare = BARE_NAME.exec(opening);
    const composed =
      built?.[1] !== undefined && built[2] !== undefined
        ? builderTemplate(source, built[1], built[2])
        : template !== null
          ? `${template[1] ?? ""}\${${template[2] ?? ""}}${template[3] ?? ""}`
          : bare?.[1] === undefined
            ? null
            : `\${${bare[1]}}`;

    let found = composed === null ? [] : namesFromTemplate(composed, resolve, tag.index);

    // A site marking a shared control and handing it no `name` leaves the path to the control's own
    // default, which is the path that mark promises — `<TeamSelect isRequired />` promises `team_id`.
    if (found.length === 0 && !ANY_NAME.test(opening)) found = [...fixes(tag[0].slice(1))];

    // Reported rather than dropped: a control that leaves the population in silence is one whose
    // schema path nothing below grades, and no floor over the rest of the tree reaches it.
    if (found.length === 0 && (OWN_PATH.test(opening) || carriesSpread(opening))) unread.push(opening);
    names.push(...found);
  }
  return { names, unread };
}

const SOURCES = sources();

/**
 * Every component the tree ships, keyed as `SOURCES` keys it. Test files are OUT: a fixture written
 * inside one is not production text for a sweep to assert over (`.claude/rules/cross-surface.md`).
 */
const COMPONENTS = new Map([...SOURCES].filter(([file]) => file.endsWith(".tsx") && !isTestFile(file)));

/** The component whose body a position sits in, with the span running to the next one or the file's end. */
function enclosingComponent(text: string, at: number): { name: string; body: string } | null {
  const declarations = [...text.matchAll(/export function (\w+)\s*\(/g)];
  const index = declarations.findLastIndex((declaration) => declaration.index <= at);
  const opening = declarations[index];
  if (opening === undefined || opening[1] === undefined) return null;

  return { name: opening[1], body: text.slice(opening.index, declarations[index + 1]?.index) };
}

/**
 * Every value a prop holds where a `name` is built from it, resolved from the tree rather than listed,
 * and every call site whose value no reader here could read.
 */
function propValues(tree: ReadonlyMap<string, string>, file: string, identifier: string, at: number): { values: string[]; unread: string[] } {
  const text = tree.get(file) ?? "";
  // The component the mark stands INSIDE, never the file's first: three rule controls share one
  // module, and a file-wide answer would credit every path to whichever is declared first.
  const enclosing = enclosingComponent(text, at);
  const component = enclosing?.name;
  // The destructuring's own punctuation, never its indentation: a prop reflowed onto one line with
  // its siblings is a prop this reader would stop finding, with every path built from it going too.
  const declared = new RegExp(String.raw`[,{]\s*` + identifier + String.raw`\s*(?:=\s*"([^"]*)")?\s*[,}]`).exec(enclosing?.body ?? "");
  if (component === undefined || declared === null) return { values: [], unread: [] };

  const fallback = declared[1];
  const literal = new RegExp(String.raw`\b` + identifier + String.raw`="([^"]*)"`);
  const expression = new RegExp(String.raw`\b` + identifier + String.raw`=\{`);
  const composed = new RegExp(String.raw`\b` + identifier + String.raw`=\{\s*` + "`([^`]*)`" + String.raw`\s*\}`);
  const values: string[] = [];
  const unread: string[] = [];

  for (const [other, otherText] of tree) {
    if (other === file) continue;

    for (const site of otherText.matchAll(new RegExp(String.raw`<` + component + String.raw`\b`, "g"))) {
      const tag = openingTag(otherText, site.index);
      // Thrown rather than skipped: an empty span fails every test below, so an unreadable site is
      // credited the default and the sweep grades a path that site may have overridden.
      if (tag === "") throw new Error(`${other}: a <${component}> site's opening tag could not be read`);
      const passed = literal.exec(tag);

      if (passed?.[1] !== undefined) {
        values.push(passed[1]);
        continue;
      }
      if (!expression.test(tag)) {
        // The default only where a site leaves the prop off: one every site overrides names a path
        // no form writes.
        if (fallback !== undefined) values.push(fallback);
        continue;
      }

      // `namesFromTemplate` again rather than a second reader of the same shape: the hole is a
      // segment a form fills, which `covers` closes against the schema's own keys at that position.
      const template = composed.exec(tag);
      const credited =
        template?.[1] === undefined ? [] : namesFromTemplate(template[1], () => [SEGMENT], site.index).filter((name) => name !== SEGMENT);

      // A hole standing alone would cover every top-level path and an opaque expression covers
      // none, so neither is credited: reported instead, because a site read as nothing leaves the
      // mark graded by whichever sibling site happens to pass a literal.
      if (credited.length === 0) unread.push(`${other}: ${tag}`);
      else values.push(...credited);
    }
  }
  return { values: [...new Set(values)], unread };
}

/** Every marked control one file leaves unplaced, and every call site of one that no reader could read. */
function unplaceableIn(tree: ReadonlyMap<string, string>, file: string): string[] {
  // A call site stands in ANOTHER file, so only `propValues` ever sees it and only a mark makes it
  // matter: collected here, where the reader that never opened that file would drop it.
  const sites: string[] = [];
  const { unread } = requiredNamesIn(
    tree.get(file) ?? "",
    (identifier, at) => {
      const resolved = propValues(tree, file, identifier, at);
      sites.push(...resolved.unread);

      return resolved.values;
    },
    (component) => fixedNameOf(tree, component),
  );

  // Deduped: one control's several marked primitives resolve the same prop once each, and a site
  // named five times is five copies of one finding.
  return [...unread.map((tag) => `${file}: ${tag}`), ...new Set(sites)];
}

/** Every marked control no reader above could place, against the file it stands in. */
const UNREAD = [...COMPONENTS.keys()].flatMap((file) => unplaceableIn(COMPONENTS, file));

/** One required name against one schema path, the wildcard standing for the segment a form fills. */
const covers = (name: string, candidate: string): boolean =>
  name.includes(SEGMENT)
    ? new RegExp(
        `^${name
          .split(SEGMENT)
          .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
          .join("[^.]+")}$`,
      ).test(candidate)
    : name === candidate;

/** A specifier against the tree's own files; a package import resolves to nothing and ends the walk. */
function resolveSpecifier(specifier: string, from: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = specifier.slice(2);
  else if (specifier.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  else return null;

  for (const suffix of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (SOURCES.has(base + suffix)) return base + suffix;
  return null;
}

/**
 * Everything one file pulls in, transitively — the sections and shared controls a form renders through.
 */
function importTree(root: string, stopAt: ReadonlySet<string>): Set<string> {
  const seen = new Set<string>();
  const pending = [root];

  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);

    for (const match of (SOURCES.get(file) ?? "").matchAll(/from\s+"([^"]+)"/g)) {
      const resolved = match[1] === undefined ? null : resolveSpecifier(match[1], file);
      // Stopped at another form, never walked through it: the Spiel editor's pickers each open a
      // create form, whose own fields belong to the payload that create sends.
      if (resolved !== null && !seen.has(resolved) && !stopAt.has(resolved)) pending.push(resolved);
    }
  }
  return seen;
}

/**
 * A schema handed to the draft block or passed into the create shell, which is the same brace either
 * way. The block is what refuses an emptied field, so what it judges is what a mark on that field promises.
 */
const JUDGED = /\bschemas?\s*[:=]\s*\{([^{}]*)\}/g;
const IDENTIFIER = /[A-Za-z_$][\w$]*/g;
const SCHEMA_MODULE = /^features\/[^/]+\/schemas\.ts$/;

/**
 * Every identifier one expression names, a local `const`'s own initialiser folded in: two forms reach
 * their schema through a `useMemo`, and a reader stopping at the first name sees the alias instead.
 */
function namedIdentifiers(text: string, expression: string): Set<string> {
  const found = new Set<string>();
  const pending = [...expression.matchAll(IDENTIFIER)].map((match) => match[0]);

  while (pending.length > 0) {
    const identifier = pending.pop();
    if (identifier === undefined || found.has(identifier)) continue;
    found.add(identifier);

    const local = new RegExp(String.raw`\bconst\s+` + identifier + String.raw`\s*=\s*([^;]*);`).exec(text);
    if (local?.[1] !== undefined) pending.push(...[...local[1].matchAll(IDENTIFIER)].map((match) => match[0]));
  }
  return found;
}

/** Where each named import comes from. A `import type` is skipped: a type carries no schema to judge with. */
function importedFrom(text: string): Map<string, string> {
  const origin = new Map<string, string>();

  for (const match of text.matchAll(/import\s+\{([^}]*)\}\s+from\s+"([^"]+)"/g)) {
    for (const part of (match[1] ?? "").split(",")) {
      const name = /(\w+)\s*$/.exec(part.trim())?.[1];
      if (name !== undefined && match[2] !== undefined) origin.set(name, match[2]);
    }
  }
  return origin;
}

/**
 * The bound schema a module's export stands for. A FACTORY is named by the bound export declared with
 * it — one parameterises the base, the other is the base applied — so neither link is a list to keep.
 */
function boundKey(moduleFile: string, identifier: string): string | null {
  const direct = `${moduleFile} :: ${identifier}`;
  if (Object.hasOwn(BOUND, direct)) return direct;

  const named = new Set<string>();
  const mentions = new RegExp(String.raw`\b` + identifier + String.raw`\b`);
  for (const declaration of blankComments(SOURCES.get(moduleFile) ?? "", moduleFile).split(/^export (?:const|(?:async )?function) /m)) {
    if (!mentions.test(declaration)) continue;
    for (const match of declaration.matchAll(/\bFL\w+PayloadSchema\b/g)) {
      if (Object.hasOwn(BOUND, `${moduleFile} :: ${match[0]}`)) named.add(match[0]);
    }
  }

  // One or nothing: a factory tied to two bound schemas names neither, and grading against a guess
  // would pair a mark with a payload no press sends.
  return named.size === 1 ? `${moduleFile} :: ${[...named][0] ?? ""}` : null;
}

/** One form, the schemas its own block judges, and any schema import in that slot this reader could not place. */
function formIn(file: string, text: string): { schemas: string[]; unresolved: string[] } {
  const source = blankComments(text, file);
  const origin = importedFrom(source);
  const schemas = new Set<string>();
  const unresolved: string[] = [];

  for (const expression of source.matchAll(JUDGED)) {
    for (const identifier of namedIdentifiers(source, expression[1] ?? "")) {
      const specifier = origin.get(identifier);
      const moduleFile = specifier === undefined ? null : resolveSpecifier(specifier, file);
      if (moduleFile === null || !SCHEMA_MODULE.test(moduleFile)) continue;

      const key = boundKey(moduleFile, identifier);
      if (key === null) unresolved.push(`${file}: ${identifier}`);
      else schemas.add(key);
    }
  }
  return { schemas: [...schemas], unresolved };
}

const FORMS = [...COMPONENTS]
  .map(([file, text]) => ({ file, ...formIn(file, text) }))
  .filter((form) => form.schemas.length > 0 || form.unresolved.length > 0);

const FORM_FILES = new Set(FORMS.map(({ file }) => file));

const READ = FORMS.map((form) => {
  const nested = new Set([...FORM_FILES].filter((file) => file !== form.file));
  const tree = new Map(
    [...importTree(form.file, nested)].flatMap((file) => (COMPONENTS.has(file) ? [[file, COMPONENTS.get(file) ?? ""] as const] : [])),
  );
  const names = new Set(
    [...tree].flatMap(
      ([file, text]) =>
        requiredNamesIn(
          text,
          (identifier, at) => propValues(tree, file, identifier, at).values,
          (component) => fixedNameOf(tree, component),
        ).names,
    ),
  );
  const probes = form.schemas.flatMap((schema) =>
    leafPaths(BOUND[schema])
      // This form's own schemas, never a name match over `BOUND`: `grund` sits on three payloads, and a
      // match makes two of them answer for a mark no control of theirs carries (`docs/frontend/spec.md` §1.9).
      .filter((probe) => probe.rootId === "" && probe.wrong !== undefined && [...names].some((name) => covers(name, probe.path)))
      .map((probe) => ({ schema, root: probe.root, path: probe.path, wrong: probe.wrong, cleared: probe.cleared })),
  );

  return { ...form, tree: [...tree.keys()], names: [...names], probes };
});

/** Every path some form marks required, discovered from the forms rather than listed beside them. */
const REQUIRED_NAMES = new Set(READ.flatMap(({ names }) => names));

/** Every file a form renders through, which is the reach inside which a mark is graded at all. */
const REACHED = new Set(READ.flatMap(({ tree }) => tree));

/**
 * A marked control whose path belongs to a payload its own form does not submit. The draw's boxes go
 * to `fl_frontend/src/features/saisons/actions.ts :: generateSpielplanAction`, which the season
 * editor's schema knows nothing of.
 */
const SUBMITTED_ELSEWHERE = [
  {
    site: "features/saisons/components/forms/AdminSaisonEditForm/FormSpielplanSection.tsx",
    schema: "features/saisons/schemas.ts :: FLGenerateSpielplanPayloadSchema",
    names: ["shape.number_of_groups", "shape.qualifiers_per_group", "shape.teams_per_group"],
  },
];

/** Each credited name its own form's schemas do not carry, against the register row answering for it. */
const STRAY = READ.flatMap(({ file, tree, names, probes }) =>
  names
    .filter((name) => !probes.some((probe) => covers(name, probe.path)))
    .map((name) => ({
      file,
      name,
      // Tied to the call site as well as to the name: a row answers for the form rendering its site
      // and for no other, so a second form crediting the same name still has to place it itself.
      row: SUBMITTED_ELSEWHERE.find((entry) => tree.includes(entry.site) && entry.names.every((path) => covers(name, path))),
    })),
);

/** Each register row's names against the schema it names, which is the row's other direction. */
const ELSEWHERE = SUBMITTED_ELSEWHERE.flatMap((row) =>
  row.names.flatMap((name) =>
    // Every probe that leaf carries rather than the first: a nullable one answers for two values, and
    // the one taken would be whichever the walker happened to emit ahead of the other.
    leafPaths(BOUND[row.schema] ?? z.object({}))
      .filter((found) => found.rootId === "" && found.path === name && found.wrong !== undefined)
      .map((probe) => ({ schema: row.schema, name, probe })),
  ),
);

/** One schema's path that a form marks required, with the emptiness that field's own control writes. */
const marked = [
  ...new Map(
    [
      ...READ.flatMap(({ probes }) => probes),
      // The register's rows grade here rather than in a case of their own: the promise a mark makes
      // is one promise, and a second copy of this body would be a second thing to keep true.
      ...ELSEWHERE.map(({ schema, probe }) => ({ schema, root: probe.root, path: probe.path, wrong: probe.wrong, cleared: probe.cleared })),
      // Keyed on the value as well as the path: one leaf carries two probes where it admits `null`,
      // and a key over the path alone would keep whichever of them the walker emitted second.
    ].map((probe) => [`${probe.schema}.${probe.path}:${String(probe.wrong)}`, probe] as const),
  ).values(),
];

/** The marked leaves a schema judges on the value alone, which is every one that cannot be handed `null`. */
const EMPTIED = marked.filter(({ cleared }) => !cleared);

/** The marked leaves that admit a cleared picker's `null`, which no leaf can refuse by itself. */
const CLEARED = marked.filter(({ cleared }) => cleared);

/**
 * What refuses the `null` a cleared control writes, where the leaf admits one. `.nullable()` IS the
 * admission, so the promise a mark makes there is a sibling field's or the browser's, and neither is
 * readable from the leaf.
 */
const NULL_REFUSED_BY: { schema: string; path: string; beside?: Record<string, unknown>; browser?: string }[] = [
  {
    schema: "features/bewerbungen/schemas.ts :: FLBewerbungEinwilligungAntwortPayloadSchema",
    path: "geburtsdatum",
    // The consenting answer is what the marked press sends; an objection must carry no date at all,
    // and its own press is not a submit, so no mark of this one ever reaches it.
    beside: { token: "abcdefghijklmnopqrst", antwort: "erteilt", whatsapp: false, text_version: "2026-09-01" },
  },
  {
    schema: "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema",
    path: "team_id",
    // A proposed school is the other half of one answer, so the pair refuses only where neither
    // stands — which is why the refusal is keyed to this field rather than to the record.
    beside: { schule: null },
  },
  {
    schema: "features/spiele/schemas.ts :: FLPatchSpielDataPayloadSchema",
    path: "sonderereignis",
    // Dropping the event is how a fixture goes back on, so the write path takes the null and has no
    // rule to lend; the switch asserting an event is what makes an empty pick wrong, and it says so.
    browser: "features/spiele/components/forms/AdminEditSpielDataForm/FormSonderereignisSection.tsx",
  },
];

/**
 * Every leaf a form marks required, pinned. The cases below are GENERATED from the marks, so a
 * deleted mark takes its own case with it while every floor over the rest of the tree stays green.
 */
const MARKED_LEAVES = [
  "features/auth/schemas.ts :: SignInPayloadSchema.email",
  "features/bewerbungen/schemas.ts :: FLBewerbungEinwilligungAntwortPayloadSchema.geburtsdatum",
  "features/bewerbungen/schemas.ts :: FLBewerbungKontaktEmailPayloadSchema.email",
  "features/bewerbungen/schemas.ts :: FLBewerbungKontaktSitzPayloadSchema.email",
  "features/bewerbungen/schemas.ts :: FLBewerbungKontaktSitzPayloadSchema.nachname",
  "features/bewerbungen/schemas.ts :: FLBewerbungKontaktSitzPayloadSchema.telefon",
  "features/bewerbungen/schemas.ts :: FLBewerbungKontaktSitzPayloadSchema.vorname",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kader.gute_spieler",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kader.voraussichtliche_groesse",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kontakte.ansprechperson.einwilligung.erteilt",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kontakte.ansprechperson.email",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kontakte.ansprechperson.nachname",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kontakte.ansprechperson.telefon",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kontakte.ansprechperson.vorname",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kontakte.stellvertretung.email",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kontakte.stellvertretung.nachname",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kontakte.stellvertretung.telefon",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kontakte.stellvertretung.vorname",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kontakte.trainer.email",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kontakte.trainer.nachname",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kontakte.trainer.telefon",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.kontakte.trainer.vorname",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.schule.address.plz",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.schule.address.stadt",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.schule.address.strasse",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.schule.full_name",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.schule.schulform",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.schule.shorthand",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.schule.team_name",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.stufengroesse",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.team_id",
  "features/bewerbungen/schemas.ts :: FLPostBewerbungPayloadSchema.trikot.wunschfarbe",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.ansprechperson.einwilligung.text_version",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.ansprechperson.email",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.ansprechperson.nachname",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.ansprechperson.telefon",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.ansprechperson.vorname",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.stellvertretung.einwilligung.text_version",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.stellvertretung.email",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.stellvertretung.nachname",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.stellvertretung.telefon",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.stellvertretung.vorname",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.trainer.einwilligung.text_version",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.trainer.email",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.trainer.nachname",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.trainer.telefon",
  "features/kontakte/schemas.ts :: FLPatchSaisonTeamKontaktePayloadSchema.kontakte.trainer.vorname",
  "features/registrierungen/schemas.ts :: FLPostRegistrierungPayloadSchema.email",
  "features/registrierungen/schemas.ts :: FLPostRegistrierungPayloadSchema.nachname",
  "features/registrierungen/schemas.ts :: FLPostRegistrierungPayloadSchema.vorname",
  "features/registrierungen/schemas.ts :: FLRegistrierungBestaetigungPayloadSchema.geburtsdatum",
  "features/registrierungen/schemas.ts :: FLRegistrierungBestaetigungPayloadSchema.umfang",
  "features/saisons/schemas.ts :: FLGenerateSpielplanPayloadSchema.shape.number_of_groups",
  "features/saisons/schemas.ts :: FLGenerateSpielplanPayloadSchema.shape.qualifiers_per_group",
  "features/saisons/schemas.ts :: FLGenerateSpielplanPayloadSchema.shape.teams_per_group",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.bewerbung.bis",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.bewerbung.von",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.end_date",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.registrierung.bis",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.registrierung.von",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.rules.draw_points",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.rules.forfeit_ergebnis.sieger_tore",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.rules.forfeit_ergebnis.verlierer_tore",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.rules.max_kadergroesse",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.rules.number_of_groups",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.rules.qualifiers_per_group",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.rules.teams_per_group",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.rules.tiebreak_order",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.rules.win_points",
  "features/saisons/schemas.ts :: FLPatchSaisonPayloadSchema.start_date",
  "features/saisons/schemas.ts :: FLPostSaisonPayloadSchema.end_date",
  "features/saisons/schemas.ts :: FLPostSaisonPayloadSchema.id",
  "features/saisons/schemas.ts :: FLPostSaisonPayloadSchema.rules.draw_points",
  "features/saisons/schemas.ts :: FLPostSaisonPayloadSchema.rules.forfeit_ergebnis.sieger_tore",
  "features/saisons/schemas.ts :: FLPostSaisonPayloadSchema.rules.forfeit_ergebnis.verlierer_tore",
  "features/saisons/schemas.ts :: FLPostSaisonPayloadSchema.rules.max_kadergroesse",
  "features/saisons/schemas.ts :: FLPostSaisonPayloadSchema.rules.number_of_groups",
  "features/saisons/schemas.ts :: FLPostSaisonPayloadSchema.rules.qualifiers_per_group",
  "features/saisons/schemas.ts :: FLPostSaisonPayloadSchema.rules.teams_per_group",
  "features/saisons/schemas.ts :: FLPostSaisonPayloadSchema.rules.tiebreak_order",
  "features/saisons/schemas.ts :: FLPostSaisonPayloadSchema.rules.win_points",
  "features/saisons/schemas.ts :: FLPostSaisonPayloadSchema.start_date",
  "features/schiedsrichter/schemas.ts :: FLPatchSchiedsrichterPayloadSchema.default_payment",
  "features/schiedsrichter/schemas.ts :: FLPatchSchiedsrichterPayloadSchema.kontakt.email",
  "features/schiedsrichter/schemas.ts :: FLPatchSchiedsrichterPayloadSchema.name",
  "features/schiedsrichter/schemas.ts :: FLPostSchiedsrichterPayloadSchema.default_payment",
  "features/schiedsrichter/schemas.ts :: FLPostSchiedsrichterPayloadSchema.kontakt.email",
  "features/schiedsrichter/schemas.ts :: FLPostSchiedsrichterPayloadSchema.name",
  "features/schiedsrichter/schemas.ts :: FLSchiedsrichterBestaetigungPayloadSchema.geburtsdatum",
  "features/schiedsrichter/schemas.ts :: FLSchiedsrichterBestaetigungPayloadSchema.umfang",
  "features/sperrliste/schemas.ts :: FLPostSperrlistePayloadSchema.email",
  "features/sperrliste/schemas.ts :: FLPostSperrlistePayloadSchema.grund",
  "features/spiele/schemas.ts :: FLPatchSpielDataPayloadSchema.sonderereignis",
  "features/spieler/schemas.ts :: FLPatchSaisonSpielerPayloadSchema.team_id",
  "features/spieler/schemas.ts :: FLPatchSpielerPayloadSchema.vorname",
  "features/spielorte/schemas.ts :: FLPatchSpielortPayloadSchema.address.plz",
  "features/spielorte/schemas.ts :: FLPatchSpielortPayloadSchema.address.stadt",
  "features/spielorte/schemas.ts :: FLPatchSpielortPayloadSchema.address.strasse",
  "features/spielorte/schemas.ts :: FLPatchSpielortPayloadSchema.default_mietpreis",
  "features/spielorte/schemas.ts :: FLPatchSpielortPayloadSchema.name",
  "features/spielorte/schemas.ts :: FLPostSpielortPayloadSchema.address.plz",
  "features/spielorte/schemas.ts :: FLPostSpielortPayloadSchema.address.stadt",
  "features/spielorte/schemas.ts :: FLPostSpielortPayloadSchema.address.strasse",
  "features/spielorte/schemas.ts :: FLPostSpielortPayloadSchema.default_mietpreis",
  "features/spielorte/schemas.ts :: FLPostSpielortPayloadSchema.name",
  "features/spieltage/schemas.ts :: FLPatchSpieltagPayloadSchema.beginn",
  "features/spieltage/schemas.ts :: FLPatchSpieltagPayloadSchema.ende",
  "features/teams/schemas.ts :: FLCreateTeamFormPayloadSchema.address.plz",
  "features/teams/schemas.ts :: FLCreateTeamFormPayloadSchema.address.stadt",
  "features/teams/schemas.ts :: FLCreateTeamFormPayloadSchema.address.strasse",
  "features/teams/schemas.ts :: FLCreateTeamFormPayloadSchema.full_name",
  "features/teams/schemas.ts :: FLCreateTeamFormPayloadSchema.gruppe",
  "features/teams/schemas.ts :: FLCreateTeamFormPayloadSchema.name",
  "features/teams/schemas.ts :: FLCreateTeamFormPayloadSchema.saison_id",
  "features/teams/schemas.ts :: FLCreateTeamFormPayloadSchema.shorthand",
  "features/teams/schemas.ts :: FLPatchSaisonTeamPayloadSchema.austritt.datum",
  "features/teams/schemas.ts :: FLPatchSaisonTeamPayloadSchema.austritt.grund",
  "features/teams/schemas.ts :: FLPatchSaisonTeamPayloadSchema.gruppe",
  "features/teams/schemas.ts :: FLPatchTeamPayloadSchema.address.plz",
  "features/teams/schemas.ts :: FLPatchTeamPayloadSchema.address.stadt",
  "features/teams/schemas.ts :: FLPatchTeamPayloadSchema.address.strasse",
  "features/teams/schemas.ts :: FLPatchTeamPayloadSchema.full_name",
  "features/teams/schemas.ts :: FLPatchTeamPayloadSchema.name",
  "features/teams/schemas.ts :: FLPatchTeamPayloadSchema.shorthand",
];

describe("what a schema does with a field its form marks required", () => {
  it("reads a mark off the control that carries it, and off no other", () => {
    /* The reader on input, not on the tree: a discovery that silently finds nothing passes every case
       below, and no count over uniform marks can tell a correct reader from a truncating one. */
    const sample = [
      "const feldPfad = (feld: string) => `kontakte.${sitz}.${feld}`;",
      '<TextField isRequired name="vorname">',
      '<TextField name="stadtteil">',
      '<NumberField name="kader.gute_spieler" isRequired minValue={0}>',
      '<TextField isRequired={isNeu} name="schule.shorthand">',
      '<TextField isRequired>Trag den name="verborgen" ein</TextField>',
      '<TextField onChange={(next) => set(next)} isRequired name="vorname">',
      "<TextField isRequired name={`${namePrefix}.strasse`}>",
      "<TextField isRequired name={`kontakte.${rolle}.telefon`}>",
      '<TextField isRequired name={feldPfad("email")}>',
      "<Select isRequired name={name}>",
      "<TextField isRequired name={`${ungelesen}.plz`}>",
    ].join("\n");

    // Twice over for `vorname`: the arrow's own `>` truncated the second one, and a set would have
    // hidden the loss behind the first.
    assert.deepEqual(
      requiredNamesIn(
        sample,
        (identifier) => (identifier === "namePrefix" ? ["address", "schule.address"] : []),
        () => [],
      ).names,
      [
        "vorname",
        "kader.gute_spieler",
        "vorname",
        "address.strasse",
        "schule.address.strasse",
        `kontakte.${SEGMENT}.telefon`,
        `kontakte.${SEGMENT}.email`,
      ],
    );
  });

  it("reports the control it cannot place, and stays silent about the one that names no path", () => {
    /* Both readings on one input: reporting neither drops a real control, and reporting both fails
       every branch for a shared control whose path is written at its call sites. */
    const sample = ["<TextField isRequired name={`${ungelesen}.plz`}>", "<Select isRequired name={name}>", "<TeamSelect isRequired />"].join(
      "\n",
    );

    assert.deepEqual(
      requiredNamesIn(
        sample,
        () => [],
        () => [],
      ).unread,
      ["<TextField isRequired name={`${ungelesen}.plz`}>"],
    );
  });

  it("takes the path a marked site leaves to the control's own default, and takes it from nothing else", () => {
    /* The reader on input, not on the tree: the tree holds two such sites and both name a control
       that fixes one, so no count over them parts this reader from one crediting every default. */
    const controls = new Map([
      [
        "gruppe.tsx",
        'export function GruppeSelect({ value, onChange, name = "gruppe", isRequired = false }: Props) {\n  <Select isRequired={isRequired} name={name}>',
      ],
      ["label.tsx", 'export function FieldLabel({ path, name = "ungenutzt" }: Props) {\n  <Label htmlFor={path}>'],
      // Two components in ONE module, which is where a file-wide read hands the first one the
      // second's default and credits a mark with a path its own control never fixes.
      [
        "paar.tsx",
        [
          "export function PaarSelect({ value, onChange, name }: Props) {\n  <Select isRequired={isRequired} name={name}>",
          'export function ZweitSelect({ value, onChange, name = "zweit" }: Props) {\n  <Select isRequired={isRequired} name={name}>',
        ].join("\n"),
      ],
    ]);
    const sample = [
      "<GruppeSelect isRequired offer={offer} />",
      '<GruppeSelect isRequired name="gruppe_zwei" />',
      "<GruppeSelect isRequired name={gewaehlt} />",
      "<FieldLabel isRequired />",
      "<Unbekannt isRequired />",
      "<PaarSelect isRequired />",
      "<ZweitSelect isRequired />",
    ].join("\n");

    const { names, unread } = requiredNamesIn(
      sample,
      () => [],
      (component) => fixedNameOf(controls, component),
    );

    // `name={gewaehlt}` overrides the default, `FieldLabel` forwards its own into no `name`, no
    // file declares `Unbekannt`, and `PaarSelect` fixes nothing of its own — each names a path this
    // reader may not invent, while `ZweitSelect` beside it does fix one.
    assert.deepEqual(names, ["gruppe", "gruppe_zwei", "zweit"]);
    assert.deepEqual(unread, []);
  });

  /* Both braced spellings on one input: the unconditional one is the bare attribute again, and the
     conditional one is the shape `requiredNamesIn` puts out of reach. */
  it("reads a mark written out as the literal it stands for", () => {
    const sample = ['<TextField isRequired={true} name="vorname">', '<TextField isRequired={isNeu} name="schule.shorthand">'].join("\n");

    assert.deepEqual(
      requiredNamesIn(
        sample,
        () => [],
        () => [],
      ).names,
      ["vorname"],
    );
    assert.deepEqual(
      requiredNamesIn(
        sample,
        () => [],
        () => [],
      ).unread,
      [],
    );
  });

  it("reads through a comment standing inside an opening tag", () => {
    const sample = ["<TextField", "  isRequired", '  name="name"', "  // `<Input>` is dressed below", "  isInvalid={fehlt}>"].join("\n");

    assert.deepEqual(
      requiredNamesIn(
        sample,
        () => [],
        () => [],
      ).names,
      ["name"],
    );
  });

  /* A spread supplies a `name` invisibly, so sparing a tag for carrying no `name=` of its own spares
     a control whose schema path nothing below grades. */
  it("reports a marked control whose name can only arrive through a props spread", () => {
    const sample = [
      "<TextField isRequired {...feld} />",
      '<TextField isRequired {...register("vorname")} />',
      '<TextField isRequired name="vorname" {...rest} />',
      "<TeamSelect isRequired onChange={(id) => set((current) => ({ ...current, id }))} />",
    ].join("\n");

    const { names, unread } = requiredNamesIn(
      sample,
      () => [],
      () => [],
    );

    assert.deepEqual(names, ["vorname"]);
    assert.deepEqual(unread, ["<TextField isRequired {...feld} />", '<TextField isRequired {...register("vorname")} />']);
  });

  /* A type argument holds the one `<` an opening tag carries outside a brace, so a walk stopping
     there hands the mark back an empty span — including the arrow inside a function type. */
  it("reads a mark past a type argument written on the control's own name", () => {
    const sample = [
      '<PickOrCreateAutocomplete<SpielortAngebot> isRequired name="spielort_id">',
      '<EntityForm<TeamCreateDraft> isRequired name="shorthand">',
      '<Feld<(value: string) => void> isRequired name="kader.trikot">',
    ].join("\n");

    assert.deepEqual(
      requiredNamesIn(
        sample,
        () => [],
        () => [],
      ).names,
      ["spielort_id", "shorthand", "kader.trikot"],
    );
  });

  /* The span a lost brace count leaves behind carries no `isRequired` either, so a mark tested
     against it is a mark this reader never saw. */
  it("reports a control whose opening tag it could not read at all", () => {
    const sample = '<TextField isRequired title={x}<div name="vorname">';

    const { names, unread } = requiredNamesIn(
      sample,
      () => [],
      () => [],
    );

    assert.deepEqual(names, []);
    assert.deepEqual(unread, ['<TextField isRequired title={x}<div name="vorname">']);
  });

  /* A real mark's own offset in its file. A fixture declaring one component answers the same for
     every position inside it, and the case below is where the choice of position decides anything. */
  const INSIDE_THE_ONLY_COMPONENT = 0;

  it("resolves a bare `name` against the component the mark stands in, not the file's first", () => {
    /* The reader on input: three rule controls share one module in the tree, and a file-wide answer
       would hand all three the first component's call sites while every floor below stayed green. */
    const controls = new Map([
      [
        "controls.tsx",
        [
          "export function SaisonRuleNumberField({ name, label }: Props) {\n  <NumberField isRequired name={name}>",
          "export function SaisonCountSelect({ name, options }: Props) {\n  <Select isRequired name={name}>",
        ].join("\n"),
      ],
      ["form.tsx", '<SaisonRuleNumberField name="rules.win_points" />\n<SaisonCountSelect name="rules.number_of_groups" />'],
    ]);
    const source = controls.get("controls.tsx") ?? "";

    assert.deepEqual(propValues(controls, "controls.tsx", "name", source.indexOf("<NumberField")).values, ["rules.win_points"]);
    assert.deepEqual(propValues(controls, "controls.tsx", "name", source.indexOf("<Select")).values, ["rules.number_of_groups"]);
  });

  it("takes a bare `name` prop through to the paths its call sites write", () => {
    /* The mark sits in the control and the path at each site, so neither file alone carries the
       pair: read as the control's own, every such mark grades nothing. */
    const sample = "<Select isRequired name={name}>";

    assert.deepEqual(
      requiredNamesIn(
        sample,
        () => ["rules.tiebreak_order"],
        () => [],
      ).names,
      ["rules.tiebreak_order"],
    );
    // Nothing invented where the call sites resolve to none, and nothing taken from the `fixes`
    // resolver either: a control handing a path on fixes none of its own.
    assert.deepEqual(
      requiredNamesIn(
        sample,
        () => [],
        () => ["team_id"],
      ).names,
      [],
    );
  });

  it("finds a prop wherever the destructuring puts it, so a reflow drops no path", () => {
    /* Every prop on one line, which is what a short parameter list formats to: an anchor on the
       indentation stops seeing it, and every address path built from it leaves the sweep. */
    const sources = new Map([
      ["fields.tsx", 'export function AddressFields({ children, namePrefix = "address", onChange }: Props) {'],
      ["form.tsx", '<AddressFields namePrefix="schule.address" />\n<AddressFields />'],
    ]);

    assert.deepEqual(propValues(sources, "fields.tsx", "namePrefix", INSIDE_THE_ONLY_COMPONENT).values, ["schule.address", "address"]);
  });

  it("credits the wildcard a template site names, and reports the site whose value is a hole alone", () => {
    /* Both spellings of a hole with nothing around it, because they reach the reader by different
       branches and a fixture holding one alone would leave the other's branch free to credit a bare
       segment. */
    const sources = new Map([
      ["controls.tsx", "export function CountSelect({ name, options }: Props) {\n  <Select isRequired name={name}>"],
      [
        "form.tsx",
        [
          "<CountSelect name={`shape.${shapeKey}`} />",
          "<CountSelect name={`${feld}.anzahl`} />",
          "<CountSelect name={`${feld}`} />",
          "<CountSelect name={feld} />",
        ].join("\n"),
      ],
    ]);

    assert.deepEqual(propValues(sources, "controls.tsx", "name", INSIDE_THE_ONLY_COMPONENT), {
      values: [`shape.${SEGMENT}`, `${SEGMENT}.anzahl`],
      unread: ["form.tsx: <CountSelect name={`${feld}`} />", "form.tsx: <CountSelect name={feld} />"],
    });
  });

  it("carries an unreadable call site up to the file that marks the control", () => {
    /* The mark is in one file and the site in another, so a finding dropped by either reader is a
       finding nobody makes: the control's file is where it has to surface. */
    const marks = new Map([
      ["controls.tsx", "export function CountSelect({ name }: Props) {\n  <Select isRequired name={name}>"],
      ["form.tsx", "<CountSelect name={feld} />"],
    ]);

    assert.deepEqual(unplaceableIn(marks, "controls.tsx"), ["form.tsx: <CountSelect name={feld} />"]);
    // The site's own file marks nothing, so the finding is not reported twice over.
    assert.deepEqual(unplaceableIn(marks, "form.tsx"), []);
  });

  it("leaves a control forwarding its own mark out of reach, with its call sites", () => {
    /* `AppDatePicker`'s spelling, where the condition is the prop of the same name: read as a mark,
       its unreadable call sites become findings against a promise the surface never makes. */
    const forwarded = new Map([
      ["picker.tsx", "export function AppDatePicker({ name, isRequired }: Props) {\n  <DatePicker isRequired={isRequired} name={name}>"],
      ["form.tsx", '<AppDatePicker name={feld} />\n<AppDatePicker name="geburtsdatum" />'],
    ]);

    assert.deepEqual(unplaceableIn(forwarded, "picker.tsx"), []);
    assert.deepEqual(
      requiredNamesIn(
        forwarded.get("picker.tsx") ?? "",
        () => ["geburtsdatum"],
        () => [],
      ).names,
      [],
    );
  });

  /* A site that overrides the prop and a site that leaves it off are told apart by the tag alone, so
     an unreadable one is a site this reader cannot classify rather than one that passed the prop. */
  it("refuses a call site whose opening tag it could not read rather than crediting the default", () => {
    const sources = new Map([
      ["fields.tsx", 'export function AddressFields({ children, namePrefix = "address", onChange }: Props) {'],
      ["form.tsx", "<AddressFields title={x}<div namePrefix={pfad} />"],
    ]);

    assert.throws(() => propValues(sources, "fields.tsx", "namePrefix", INSIDE_THE_ONLY_COMPONENT), /form\.tsx/);
  });

  it("reads a schema expression down to the identifiers that can name one", () => {
    /* The reader on input, not on the tree: an alias chain that stopped expanding leaves its form
       holding no schema, and a population that drops the form passes every case below. */
    const sample = [
      "const antwortSchema = useMemo(() => buildAntwortPayloadSchema(mindestalter), [mindestalter]);",
      "const unused = FLVerborgenPayloadSchema;",
    ].join("\n");

    assert.deepEqual([...namedIdentifiers(sample, " einwilligung: antwortSchema ")].sort(), [
      "antwortSchema",
      "buildAntwortPayloadSchema",
      "einwilligung",
      "mindestalter",
      "useMemo",
    ]);
    assert.deepEqual([...namedIdentifiers(sample, "FLPostSperrlistePayloadSchema")], ["FLPostSperrlistePayloadSchema"]);
  });

  it("takes a renamed import from the module it was renamed in, and leaves a type import alone", () => {
    /* A type and its schema differ by a suffix, so crediting `import type` would place a form on a
       module export that holds no `safeParse` and grade its marks against nothing. */
    const sample = [
      'import { FLPostTeamPayloadSchema as teamSchema, other } from "@/features/teams/schemas";',
      'import type { FLPostTeamPayload } from "@/features/teams/schemas";',
    ].join("\n");

    assert.deepEqual(
      [...importedFrom(sample)],
      [
        ["teamSchema", "@/features/teams/schemas"],
        ["other", "@/features/teams/schemas"],
      ],
    );
  });

  it("places every marked control in the tree", () => {
    /* A path this reader cannot build is a finding, never a member it drops: dropped, it takes its
       schema out of the grading below while every floor the rest of the population keeps stays green. */
    assert.deepEqual(UNREAD, []);
  });

  it("resolves a schema for every form that names one", () => {
    /* A schema import the reader cannot place is louder than a form silently holding none: unplaced,
       the form grades nothing and its marks land in no payload at all. */
    const unresolved = READ.flatMap(({ unresolved: found }) => found);

    assert.deepEqual(unresolved, [], `these forms judge a draft against something no bound schema answers for:\n  ${unresolved.join("\n  ")}`);
  });

  it("reaches every marked control from a form whose schema it resolved", () => {
    /* The population's own floor, derived from the marks rather than from the pairing below: a form
       that stopped resolving takes its whole tree out of the grading, and every case below stays green. */
    const stranded = [...COMPONENTS]
      .filter(([file]) => !REACHED.has(file))
      .filter(([file, text]) => {
        const { names, unread } = requiredNamesIn(
          text,
          (identifier, at) => propValues(COMPONENTS, file, identifier, at).values,
          (component) => fixedNameOf(COMPONENTS, component),
        );

        return names.length + unread.length > 0;
      })
      .map(([file]) => file);

    assert.deepEqual(stranded, [], `these files mark a control that no form's own schema grades:\n  ${stranded.join("\n  ")}`);
  });

  it("lands every required name on a path of the schema its own form submits", () => {
    /* The mark and the path are written in two files, and a rename in either parts them: the pair
       leaves `marked` below, its case with it, and no floor over the rest of the tree moves. */
    const unplaced = STRAY.filter(({ row }) => row === undefined).map(({ file, name }) => `${file}: ${name}`);

    assert.deepEqual(unplaced, [], `these forms mark a path their own payload schema does not carry:\n  ${unplaced.join("\n  ")}`);
  });

  it("names in every register row exactly the leaves its site's own name covers", () => {
    /* Both directions, because each is a silent loss that leaves every floor green: a renamed schema
       key leaves a row naming nothing, and a name dropped from a row takes its path out of the
       grading above. */
    const mismatched = STRAY.flatMap(({ name, row }) => {
      if (row === undefined) return [];
      const covered = leafPaths(BOUND[row.schema] ?? z.object({}))
        .filter((probe) => probe.rootId === "" && probe.wrong !== undefined && covers(name, probe.path))
        .map((probe) => probe.path);

      return [...covered.filter((path) => !row.names.includes(path)), ...row.names.filter((path) => !covered.includes(path))].map(
        (path) => `${row.schema}.${path}`,
      );
    });

    assert.deepEqual(mismatched, [], `these register rows and their schemas name different paths:\n  ${mismatched.join("\n  ")}`);
  });

  it("keeps no register row whose site is gone, or whose names its own form now carries", () => {
    /* A row is the claim that one form cannot answer for a name. Left standing once the form can, or
       once its site is deleted, it is an excuse waiting for the next stray to arrive under it. */
    const answered = new Set(STRAY.flatMap(({ row }) => (row === undefined ? [] : [row])));
    const stale = SUBMITTED_ELSEWHERE.filter((row) => !COMPONENTS.has(row.site) || !answered.has(row)).map((row) => row.site);

    assert.deepEqual(stale, [], `these register rows answer for nothing on the tree:\n  ${stale.join("\n  ")}`);
  });

  it("answers in the null register for exactly the marked leaves that admit a cleared control's null", () => {
    /* Both directions: a new nullable marked leaf arriving with no row is a promise nothing keeps,
       and a row outliving its leaf is an excuse waiting for the next one to arrive under it. */
    const admitting = CLEARED.map(({ schema, path }) => `${schema}.${path}`).sort();
    const answered = NULL_REFUSED_BY.map((row) => `${row.schema}.${row.path}`).sort();

    assert.deepEqual(answered, admitting);
  });

  it("refuses the null beside the siblings every register row names, in German", () => {
    /* The row's own payload is parsed rather than believed: a sibling renamed, or a refinement
       dropped, leaves the row claiming a refusal the schema stopped making. */
    const unrefused = NULL_REFUSED_BY.flatMap((row) => {
      if (row.beside === undefined) return [];
      const payload: Record<string, unknown> = { ...row.beside };
      setAt(payload, row.path.split("."), null);
      const parsed = (BOUND[row.schema] as Parsed | undefined)?.safeParse(payload);
      const issue = (parsed?.error?.issues ?? []).find((found) => found.path.join(".") === row.path);

      if (issue === undefined) return [`${row.schema}.${row.path}: nothing refused the null`];
      return ZOD_DEFAULT.test(issue.message) ? [`${row.schema}.${row.path}: "${issue.message}"`] : [];
    });

    assert.deepEqual(unrefused, [], `these register rows do not answer a cleared control in German:\n  ${unrefused.join("\n  ")}`);
  });

  it("keeps a browser-only row only while its schema still takes the null and its control still stands", () => {
    /* The one row shape that checks nothing about a schema has to check that there is still nothing
       to check: a schema that started refusing makes the row an excuse, and so does a deleted file. */
    const stale = NULL_REFUSED_BY.flatMap((row) => {
      if (row.browser === undefined) return [];
      const payload: Record<string, unknown> = {};
      setAt(payload, row.path.split("."), null);
      const parsed = (BOUND[row.schema] as Parsed | undefined)?.safeParse(payload);
      const refused = (parsed?.error?.issues ?? []).some((found) => found.path.join(".") === row.path);

      return refused || !COMPONENTS.has(row.browser) ? [`${row.schema}.${row.path}`] : [];
    });

    assert.deepEqual(stale, [], `these browser-only rows no longer describe the tree:\n  ${stale.join("\n  ")}`);
  });

  it("grades exactly the leaves the register names, so a mark deleted is a failure rather than a smaller run", () => {
    /* Both directions from one comparison: a mark removed leaves a name here with nothing behind it,
       and a mark added arrives with no row, which is where its refusal is read for the first time. */
    const graded = EMPTIED.map(({ schema, path }) => `${schema}.${path}`).sort();

    assert.deepEqual(graded, [...MARKED_LEAVES].sort());
  });

  it("found the forms, the marks and the schema paths they land on", () => {
    /* Floors, because a walk that stopped resolving would leave every case below true of nothing.
       Set one form section under the tree's own count, so a field made optional does not re-open
       the number while a collapse still hits them. */
    assert.ok(COMPONENTS.size >= 200, `expected at least 200 components, found ${String(COMPONENTS.size)}`);
    assert.ok(READ.length >= 16, `expected at least 16 forms judging a bound schema, found ${String(READ.length)}`);
    assert.ok(REQUIRED_NAMES.size >= 37, `expected at least 37 paths marked required, found ${String(REQUIRED_NAMES.size)}`);
    assert.ok(marked.length >= 80, `expected at least 80 schema paths carrying a mark, found ${String(marked.length)}`);
  });

  for (const { schema, root, path: fieldPath, wrong } of EMPTIED) {
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
