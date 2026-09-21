import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import z from "zod";

import { sources } from "@/core/actionSources.ts";
import { blankComments } from "@/core/blankComments.ts";
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
// would lose `<X name="a" isRequired>`. The braced arm takes the literal alone, a conditional mark
// being out of `requiredNamesIn`'s reach.
const MARK = /\bisRequired(?![\w=])|\bisRequired=\{\s*true\s*\}/;
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
    if (!MARK.test(opening)) continue;

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

/** Every value a prop holds where a `name` is built from it, resolved from the tree rather than listed. */
function propValues(tree: ReadonlyMap<string, string>, file: string, identifier: string, at: number): string[] {
  const text = tree.get(file) ?? "";
  // The component the mark stands INSIDE, never the file's first: three rule controls share one
  // module, and a file-wide answer would credit every path to whichever is declared first.
  const enclosing = enclosingComponent(text, at);
  const component = enclosing?.name;
  // The destructuring's own punctuation, never its indentation: a prop reflowed onto one line with
  // its siblings is a prop this reader would stop finding, with every path built from it going too.
  const declared = new RegExp(String.raw`[,{]\s*` + identifier + String.raw`\s*(?:=\s*"([^"]*)")?\s*[,}]`).exec(enclosing?.body ?? "");
  if (component === undefined || declared === null) return [];

  const fallback = declared[1];
  const literal = new RegExp(String.raw`\b` + identifier + String.raw`="([^"]*)"`);
  const expression = new RegExp(String.raw`\b` + identifier + String.raw`=\{`);
  const values: string[] = [];

  for (const [other, otherText] of tree) {
    if (other === file) continue;

    for (const site of otherText.matchAll(new RegExp(String.raw`<` + component + String.raw`\b`, "g"))) {
      const tag = openingTag(otherText, site.index);
      // Thrown rather than skipped: an empty span fails both tests below, so an unreadable site is
      // credited the default and the sweep grades a path that site may have overridden.
      if (tag === "") throw new Error(`${other}: a <${component}> site's opening tag could not be read`);
      const passed = literal.exec(tag);

      if (passed?.[1] !== undefined) values.push(passed[1]);
      // The default only where a site leaves the prop off, and nothing where one passes an
      // expression: a default every site overrides names a path no form writes.
      else if (!expression.test(tag) && fallback !== undefined) values.push(fallback);
    }
  }
  return [...new Set(values)];
}

/** Every marked control no reader above could place, against the file it stands in. */
const UNREAD = [...COMPONENTS].flatMap(([file, text]) =>
  requiredNamesIn(
    text,
    (identifier, at) => propValues(COMPONENTS, file, identifier, at),
    (component) => fixedNameOf(COMPONENTS, component),
  ).unread.map((tag) => `${file}: ${tag}`),
);

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
 * A second copy of `fl_frontend/src/core/refusalPaths.test.ts`'s walk: two instances that rhyme are
 * cheaper duplicated than abstracted into a module neither sweep owns.
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
  for (const declaration of blankComments(SOURCES.get(moduleFile) ?? "").split(/^export (?:const|(?:async )?function) /m)) {
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
  const source = blankComments(text);
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
          (identifier, at) => propValues(tree, file, identifier, at),
          (component) => fixedNameOf(tree, component),
        ).names,
    ),
  );
  const probes = form.schemas.flatMap((schema) =>
    leafPaths(BOUND[schema])
      // This form's own schemas, never a name match over `BOUND`: `grund` sits on three payloads, and a
      // match makes two of them answer for a mark no control of theirs carries (`docs/frontend/spec.md` §1.9).
      .filter((probe) => probe.rootId === "" && probe.wrong !== undefined && [...names].some((name) => covers(name, probe.path)))
      .map((probe) => ({ schema, root: probe.root, path: probe.path, wrong: probe.wrong })),
  );

  return { ...form, tree: [...tree.keys()], names: [...names], probes };
});

/** Every path some form marks required, discovered from the forms rather than listed beside them. */
const REQUIRED_NAMES = new Set(READ.flatMap(({ names }) => names));

/** Every file a form renders through, which is the reach inside which a mark is graded at all. */
const REACHED = new Set(READ.flatMap(({ tree }) => tree));

/** One schema's path that a form marks required, with the emptiness that field's own control writes. */
const marked = [...new Map(READ.flatMap(({ probes }) => probes.map((probe) => [`${probe.schema}.${probe.path}`, probe] as const))).values()];

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

    assert.deepEqual(propValues(controls, "controls.tsx", "name", source.indexOf("<NumberField")), ["rules.win_points"]);
    assert.deepEqual(propValues(controls, "controls.tsx", "name", source.indexOf("<Select")), ["rules.number_of_groups"]);
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

    assert.deepEqual(propValues(sources, "fields.tsx", "namePrefix", INSIDE_THE_ONLY_COMPONENT), ["schule.address", "address"]);
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
          (identifier, at) => propValues(COMPONENTS, file, identifier, at),
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
    const unplaced = READ.flatMap(({ file, names, probes }) =>
      names.filter((name) => !probes.some((probe) => covers(name, probe.path))).map((name) => `${file}: ${name}`),
    );

    assert.deepEqual(unplaced, [], `these forms mark a path their own payload schema does not carry:\n  ${unplaced.join("\n  ")}`);
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
