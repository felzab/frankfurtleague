import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import z from "zod";

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
/** A `name` this control does not fix itself, its path being written wherever the control is used. */
const OWN_PATH = /\bname=(?!\{\w+\})/;

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
function namesFromTemplate(template: string, resolve: (identifier: string) => readonly string[]): string[] {
  const hole = /^([^`${]*)\$\{(\w+)\}([^`${]*)$/.exec(template);
  if (hole === null) return template.includes("${") ? [] : [template];

  const [, head = "", identifier = "", tail = ""] = hole;

  return head === "" ? resolve(identifier).map((value) => `${value}${tail}`) : [`${head}${SEGMENT}${tail}`];
}

/**
 * Every path a required control names, and every marked control this reader could not place
 * (`docs/frontend/spec.md :: I17`). A conditional `isRequired` is out of reach.
 */
function requiredNamesIn(raw: string, resolve: (identifier: string) => readonly string[]): { names: string[]; unread: string[] } {
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
    const composed =
      built?.[1] !== undefined && built[2] !== undefined
        ? builderTemplate(source, built[1], built[2])
        : template === null
          ? null
          : `${template[1] ?? ""}\${${template[2] ?? ""}}${template[3] ?? ""}`;

    // Reported rather than dropped: a control that leaves the population in silence is one whose
    // schema path nothing below grades, and no floor over the rest of the tree reaches it.
    const found = composed === null ? [] : namesFromTemplate(composed, resolve);
    if (found.length === 0 && (OWN_PATH.test(opening) || carriesSpread(opening))) unread.push(opening);
    names.push(...found);
  }
  return { names, unread };
}

const collectComponents = (dir: string): string[] => filesUnder(dir, (name) => name.endsWith(".tsx") && !isTestFile(name), 200);

const COMPONENTS = new Map(collectComponents(SRC_DIR).map((file) => [file, readFileSync(file, "utf8")]));

/** Every value a prop holds where a `name` is built from it, resolved from the tree rather than listed. */
function propValues(sources: ReadonlyMap<string, string>, file: string, identifier: string): string[] {
  const text = sources.get(file) ?? "";
  const component = /export function (\w+)\s*\(/.exec(text)?.[1];
  // The destructuring's own punctuation, never its indentation: a prop reflowed onto one line with
  // its siblings is a prop this reader would stop finding, with every path built from it going too.
  const declared = new RegExp(String.raw`[,{]\s*` + identifier + String.raw`\s*(?:=\s*"([^"]*)")?\s*[,}]`).exec(text);
  if (component === undefined || declared === null) return [];

  const fallback = declared[1];
  const literal = new RegExp(String.raw`\b` + identifier + String.raw`="([^"]*)"`);
  const expression = new RegExp(String.raw`\b` + identifier + String.raw`=\{`);
  const values: string[] = [];

  for (const [other, otherText] of sources) {
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

const READ = [...COMPONENTS].map(([file, text]) => ({
  file,
  ...requiredNamesIn(text, (identifier) => propValues(COMPONENTS, file, identifier)),
}));

/** Every path some form marks required, discovered from the forms rather than listed beside them. */
const REQUIRED_NAMES = new Set(READ.flatMap(({ names }) => names));

/** Every marked control no reader above could place, against the file it stands in. */
const UNREAD = READ.flatMap(({ file, unread }) => unread.map((tag) => `${path.relative(SRC_DIR, file).split(path.sep).join("/")}: ${tag}`));

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

/** One schema's path that a form marks required, with the emptiness that field's own control writes. */
const marked = Object.entries(BOUND).flatMap(([name, schema]) =>
  leafPaths(schema)
    .filter((probe) => probe.rootId === "" && probe.wrong !== undefined && [...REQUIRED_NAMES].some((required) => covers(required, probe.path)))
    .map((probe) => ({ schema: name, root: probe.root, path: probe.path, wrong: probe.wrong })),
);

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
    assert.deepEqual(requiredNamesIn(sample, (identifier) => (identifier === "namePrefix" ? ["address", "schule.address"] : [])).names, [
      "vorname",
      "kader.gute_spieler",
      "vorname",
      "address.strasse",
      "schule.address.strasse",
      `kontakte.${SEGMENT}.telefon`,
      `kontakte.${SEGMENT}.email`,
    ]);
  });

  it("reports the control it cannot place, and stays silent about the one that names no path", () => {
    /* Both readings on one input: reporting neither drops a real control, and reporting both fails
       every branch for a shared control whose path is written at its call sites. */
    const sample = ["<TextField isRequired name={`${ungelesen}.plz`}>", "<Select isRequired name={name}>", "<TeamSelect isRequired />"].join(
      "\n",
    );

    assert.deepEqual(requiredNamesIn(sample, () => []).unread, ["<TextField isRequired name={`${ungelesen}.plz`}>"]);
  });

  /* Both braced spellings on one input: the unconditional one is the bare attribute again, and the
     conditional one is the shape `requiredNamesIn` puts out of reach. */
  it("reads a mark written out as the literal it stands for", () => {
    const sample = ['<TextField isRequired={true} name="vorname">', '<TextField isRequired={isNeu} name="schule.shorthand">'].join("\n");

    assert.deepEqual(requiredNamesIn(sample, () => []).names, ["vorname"]);
    assert.deepEqual(requiredNamesIn(sample, () => []).unread, []);
  });

  it("reads through a comment standing inside an opening tag", () => {
    const sample = ["<TextField", "  isRequired", '  name="name"', "  // `<Input>` is dressed below", "  isInvalid={fehlt}>"].join("\n");

    assert.deepEqual(requiredNamesIn(sample, () => []).names, ["name"]);
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

    const { names, unread } = requiredNamesIn(sample, () => []);

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

    assert.deepEqual(requiredNamesIn(sample, () => []).names, ["spielort_id", "shorthand", "kader.trikot"]);
  });

  /* The span a lost brace count leaves behind carries no `isRequired` either, so a mark tested
     against it is a mark this reader never saw. */
  it("reports a control whose opening tag it could not read at all", () => {
    const sample = '<TextField isRequired title={x}<div name="vorname">';

    const { names, unread } = requiredNamesIn(sample, () => []);

    assert.deepEqual(names, []);
    assert.deepEqual(unread, ['<TextField isRequired title={x}<div name="vorname">']);
  });

  it("finds a prop wherever the destructuring puts it, so a reflow drops no path", () => {
    /* Every prop on one line, which is what a short parameter list formats to: an anchor on the
       indentation stops seeing it, and every address path built from it leaves the sweep. */
    const sources = new Map([
      ["fields.tsx", 'export function AddressFields({ children, namePrefix = "address", onChange }: Props) {'],
      ["form.tsx", '<AddressFields namePrefix="schule.address" />\n<AddressFields />'],
    ]);

    assert.deepEqual(propValues(sources, "fields.tsx", "namePrefix"), ["schule.address", "address"]);
  });

  /* A site that overrides the prop and a site that leaves it off are told apart by the tag alone, so
     an unreadable one is a site this reader cannot classify rather than one that passed the prop. */
  it("refuses a call site whose opening tag it could not read rather than crediting the default", () => {
    const sources = new Map([
      ["fields.tsx", 'export function AddressFields({ children, namePrefix = "address", onChange }: Props) {'],
      ["form.tsx", "<AddressFields title={x}<div namePrefix={pfad} />"],
    ]);

    assert.throws(() => propValues(sources, "fields.tsx", "namePrefix"), /form\.tsx/);
  });

  it("places every marked control in the tree", () => {
    /* A path this reader cannot build is a finding, never a member it drops: dropped, it takes its
       schema out of the grading below while every floor the rest of the population keeps stays green. */
    assert.deepEqual(UNREAD, []);
  });

  it("lands every required name on a schema path", () => {
    /* The mark and the path are written in two files, and a rename in either parts them: the pair
       leaves `marked` below, its case with it, and no floor over the rest of the tree moves. */
    const unplaced = [...REQUIRED_NAMES].filter((required) => !marked.some((probe) => covers(required, probe.path)));

    assert.deepEqual(unplaced, [], `these forms mark a path no payload schema carries:\n  ${unplaced.join("\n  ")}`);
  });

  it("found the marks and the schema paths they land on", () => {
    /* Floors, because a walk that stopped resolving would leave every case below true of nothing.
       Set one form section under the tree's own count, so a field made optional does not re-open
       the number while a collapse still hits them. */
    assert.ok(REQUIRED_NAMES.size >= 37, `expected at least 37 paths marked required, found ${String(REQUIRED_NAMES.size)}`);
    assert.ok(marked.length >= 140, `expected at least 140 schema paths carrying a mark, found ${String(marked.length)}`);
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
