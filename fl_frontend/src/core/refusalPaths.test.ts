import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import z from "zod";

import { filesUnder } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

// Test files are IN: a mapper spelled inside one would still be a mapper this sweep has to grade.
const sources = new Map(
  filesUnder(SRC_DIR, (name) => name.endsWith(".ts") || name.endsWith(".tsx"), 400).map((file) => [
    path.relative(SRC_DIR, file).split(path.sep).join("/"),
    readFileSync(file, "utf8"),
  ]),
);
const components = [...sources.keys()].filter((file) => file.endsWith(".tsx"));

/**
 * Every pattern here declares both groups outside an alternation, so a match always fills them.
 * `noUncheckedIndexedAccess` cannot see that, and a cast would hide a pattern that later could not.
 */
function* capturePairs(text: string, pattern: RegExp): Generator<[string, string]> {
  for (const match of text.matchAll(pattern)) {
    const [, first, second] = match;
    if (first !== undefined && second !== undefined) yield [first, second];
  }
}

const sliceOf = (file: string): string => file.split("/")[1] ?? "";

const actionSlice = new Map<string, string>();
/** Payload schema export → the actions that parse it, and so can report on its paths. */
const schemaActions = new Map<string, string[]>();

for (const [file, text] of sources) {
  if (!/^features\/[^/]+\/actions\.ts$/.test(file)) continue;
  // Split, not parsed: a body runs to the next declaration, enough to attribute a `safeParse`.
  for (const body of text.split("export async function ").slice(1)) {
    const action = /^(\w+)/.exec(body)?.[1];
    if (action === undefined) continue;

    actionSlice.set(action, sliceOf(file));
    for (const match of body.matchAll(/(FL\w+Schema)\.safeParse/g)) {
      const schema = match[1];
      if (schema !== undefined) schemaActions.set(schema, [...(schemaActions.get(schema) ?? []), action]);
    }
  }
}

const callersOf = (actions: readonly string[]): string[] =>
  components.filter((file) => actions.some((action) => (sources.get(file) ?? "").includes(`${action}(`)));

function resolveSpecifier(specifier: string, from: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = specifier.slice(2);
  else if (specifier.startsWith(".")) base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
  else return null;

  for (const suffix of ["", ".tsx", ".ts", "/index.tsx", "/index.ts"]) if (sources.has(base + suffix)) return base + suffix;
  return null;
}

function importTree(roots: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const pending = [...roots];

  while (pending.length > 0) {
    const file = pending.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);

    for (const match of (sources.get(file) ?? "").matchAll(/from\s+"([^"]+)"/g)) {
      const specifier = match[1];
      if (specifier === undefined) continue;

      const resolved = resolveSpecifier(specifier, file);
      if (resolved !== null && !seen.has(resolved)) pending.push(resolved);
    }
  }
  return seen;
}

const ATTRIBUTE_LITERAL = /\b(\w+)\s*=\s*"([^"]+)"/g;
const ATTRIBUTE_TEMPLATE = /\b(\w+)=\{`([^`]+)`\}/g;

/**
 * `name`, plus every identifier a component forwards into one. Derived rather than listed, so a
 * further spelling is covered by the forwarding line alone.
 */
const NAME_PROPS = new Set(["name"]);
for (const text of sources.values()) {
  for (const match of text.matchAll(/\bname=\{(\w+)\}/g)) if (match[1] !== undefined) NAME_PROPS.add(match[1]);
}

/**
 * Data rather than inference: one template renders a different path per side of the fixture, and
 * only the call sites know which. An unbound identifier fails below rather than dropping its paths.
 */
const NAME_TEMPLATE_BINDINGS: Record<string, readonly string[]> = {
  fieldName: ["team1", "team2"],
  slot: ["team1", "team2"],
  namePrefix: ["address", "schule.address"],
  // The draw renders its three shape fields from one table, so these paths resolve only here.
  shapeKey: ["number_of_groups", "teams_per_group", "qualifiers_per_group"],
  // The contacts panel renders one seat three times from `KONTAKT_ROLLEN`, for the same reason.
  rolle: ["trainer", "ansprechperson", "stellvertretung"],
  // The application form renders one seat three times, as the contacts panel does.
  seat: ["trainer", "ansprechperson", "stellvertretung"],
};

/**
 * A name a component builds by calling a local helper — `name={path("vorname")}`. Declared rather than inferred:
 * the helper's body is a closure this sweep does not evaluate, and an unlisted one is asserted below.
 */
const NAME_CALL_BINDINGS: Record<string, string> = {
  path: "kontakte.${seat}.${arg}",
};

/** Every `name={helper("literal")}` in the tree, as helper and argument. */
function* nameCalls(text: string): Generator<[string, string]> {
  for (const match of text.matchAll(/\bname=\{(\w+)\("([^"]*)"\)\}/g)) {
    const [, helper, argument] = match;
    if (helper !== undefined && argument !== undefined) yield [helper, argument];
  }
}

function calledHelpers(): Set<string> {
  const found = new Set<string>();
  for (const [file, text] of sources) {
    if (!file.endsWith(".tsx")) continue;
    for (const [helper] of nameCalls(text)) found.add(helper);
  }
  return found;
}

function templateIdentifiers(): Set<string> {
  const found = new Set<string>();
  for (const [file, text] of sources) {
    if (!file.endsWith(".tsx")) continue;
    for (const [prop, template] of capturePairs(text, ATTRIBUTE_TEMPLATE)) {
      if (!NAME_PROPS.has(prop)) continue;
      for (const match of template.matchAll(/\$\{(\w+)\}/g)) if (match[1] !== undefined) found.add(match[1]);
    }
  }
  return found;
}

function renderedNames(files: Iterable<string>): Set<string> {
  const names = new Set<string>();

  for (const file of files) {
    if (!file.endsWith(".tsx")) continue;
    const text = sources.get(file) ?? "";

    // A JSX attribute and a destructured prop default read alike on purpose: a component may
    // declare its own `name` default and its callers rely on it.
    for (const [prop, literal] of capturePairs(text, ATTRIBUTE_LITERAL)) if (NAME_PROPS.has(prop)) names.add(literal);

    for (const [prop, template] of capturePairs(text, ATTRIBUTE_TEMPLATE)) {
      if (!NAME_PROPS.has(prop)) continue;

      let expanded = [template];
      for (const [identifier, values] of Object.entries(NAME_TEMPLATE_BINDINGS)) {
        const token = `\${${identifier}}`;
        expanded = expanded.flatMap((form) => (form.includes(token) ? values.map((value) => form.split(token).join(value)) : [form]));
      }
      for (const form of expanded) if (!form.includes("${")) names.add(form);
    }

    for (const [helper, argument] of nameCalls(text)) {
      const shape = NAME_CALL_BINDINGS[helper];
      if (shape === undefined) continue;

      let expanded = [shape.split("${arg}").join(argument)];
      for (const [identifier, values] of Object.entries(NAME_TEMPLATE_BINDINGS)) {
        const token = `\${${identifier}}`;
        expanded = expanded.flatMap((form) => (form.includes(token) ? values.map((value) => form.split(token).join(value)) : [form]));
      }
      for (const form of expanded) if (!form.includes("${")) names.add(form);
    }
  }
  return names;
}

type JsonSchema = Record<string, unknown>;

/**
 * Every dotted path a Zod object can attach an issue to, read off `toJSONSchema` as
 * `apiContract.test.ts` does. A union contributes every branch's paths: a refusal names whichever
 * variant the draft is in, and all of them are the form's to render.
 */
function payloadPaths(node: JsonSchema, prefix = ""): string[] {
  const branches = (node.anyOf ?? node.oneOf) as JsonSchema[] | undefined;
  if (branches !== undefined) return [...new Set(branches.flatMap((branch) => payloadPaths(branch, prefix)))];

  // An issue inside an array is keyed by index, so the element carries paths of its own.
  const items = node.items as JsonSchema | undefined;
  if (items !== undefined) return [prefix, ...payloadPaths(items, `${prefix}.0`)];

  const properties = node.properties as Record<string, JsonSchema> | undefined;
  if (properties === undefined) return prefix === "" ? [] : [prefix];

  return Object.entries(properties).flatMap(([key, value]) => payloadPaths(value, prefix === "" ? key : `${prefix}.${key}`));
}

const WRITTEN_NOT_PICKED = "the form writes it from a constant, so no control offers it and no refusal can land on one";
const THE_SCHOOL_ITSELF = "the picker writes `team_id` or the new-school block; the object itself has no control";
const A_STUFE_ROW = "the picker renders the whole set under one name, so a refusal on a single member has no control of its own";
const IN_THE_PATH = "in the request URI, off an already-parsed record — no input, and no refusal names it";
const THE_PAGE_SEASON = "the page's selected season, parsed at `.length(4)` before the control renders";

const NO_FORM_AT_ALL = "a row button's whole argument: an id in the path, no request body, no form";

const DRAW_HAS_NO_FIELDS = "the draw's panel: the season is in the path and the replace is a two-press escalation, neither being an input";

const ANONYMISATION_HAS_NO_FIELDS =
  "the anonymisation's panel: the id is in the path and the confirmation is a two-press escalation, neither being an input";

/** A panel rather than a row button, which is why `NO_FORM_AT_ALL` would read wrong beside it. */
const ERASURE_HAS_NO_FIELDS =
  "the erasure's panel: the id is in the path and the confirmation is a two-press escalation, neither being an input";

/** Not `ERASURE_HAS_NO_FIELDS`: this address travels in the body, so a reason naming a path parameter would read false beside it. */
const THE_PERSON_THE_PANEL_IS_FOR =
  "the address of the person whose panel this is, handed in as a prop, so no control offers it and no refusal can land on one";

const UNDRAW_HAS_NO_FIELDS =
  "the undraw's panel: the season is in the path and the confirmation is a two-press escalation, neither being an input";

/**
 * A nullable object is refused on its own path only for a value that is neither the object nor
 * `null` — a shape the typed payload builders cannot produce. Its fields are swept individually.
 */
const RECORD_ITSELF = "the record's own path: refusable only on a shape the typed payload cannot build";

/** One member, so the panel writes it from `EINWILLIGUNG_UMFANG` rather than asking a question with one answer. */
const ONE_SCOPE = "the agreement's only scope, written by the panel rather than picked";

/** The create dialog offers no control over the window, so the null it sends is the only value it can produce. */
const WINDOW_OPENS_LATER = "the create draft sends the null the field allows; the window is opened in the season editor";

/**
 * Payload paths no input renders, each with the reason it cannot be refused on. **A path listed
 * here is a decision, not a backlog entry** — the sweep fails on a path neither rendered nor
 * listed, and on a listed path that no longer exists.
 */
const EXEMPT: Record<string, Record<string, string>> = {
  FLActivateSaisonPayloadSchema: { id: NO_FORM_AT_ALL },
  FLGenerateSpielplanPayloadSchema: { id: DRAW_HAS_NO_FIELDS, replace: DRAW_HAS_NO_FIELDS, shape: RECORD_ITSELF },
  FLUndrawSpielplanPayloadSchema: { id: UNDRAW_HAS_NO_FIELDS },
  FLDeleteSpielerPayloadSchema: { id: NO_FORM_AT_ALL },
  FLEraseSpielerPayloadSchema: { id: ERASURE_HAS_NO_FIELDS },
  FLKontaktErasurePayloadSchema: { email: THE_PERSON_THE_PANEL_IS_FOR },
  FLAnonymiseSchiedsrichterPayloadSchema: { id: ANONYMISATION_HAS_NO_FIELDS },
  FLDeleteTeamPayloadSchema: { id: NO_FORM_AT_ALL },
  FLReactivateSpielerPayloadSchema: { id: NO_FORM_AT_ALL },
  FLReactivateTeamPayloadSchema: { id: NO_FORM_AT_ALL },
  FLSchiedsrichterKeyPayloadSchema: { id: NO_FORM_AT_ALL },
  FLSpielortKeyPayloadSchema: { id: NO_FORM_AT_ALL },
  FLSaisonSpielerKeyPayloadSchema: { spieler_id: NO_FORM_AT_ALL, saison_id: NO_FORM_AT_ALL },

  // The triage's two decisions: the application is the page, so its id is never typed. Everything
  // else on both payloads is a control — the group and the kit picker, and the decline's reason.
  FLAnnehmenBewerbungPayloadSchema: { id: IN_THE_PATH },
  FLAblehnenBewerbungPayloadSchema: { id: IN_THE_PATH },

  FLPatchSaisonPayloadSchema: { id: IN_THE_PATH, bewerbung: RECORD_ITSELF, "rules.erlaubte_stufen.0": A_STUFE_ROW },
  FLPatchSchiedsrichterPayloadSchema: { id: IN_THE_PATH },
  FLPatchSpielerPayloadSchema: { id: IN_THE_PATH },
  FLPatchSpielortPayloadSchema: { id: IN_THE_PATH },
  FLPatchSpieltagPayloadSchema: { id: IN_THE_PATH },

  FLPatchTeamPayloadSchema: {
    id: IN_THE_PATH,
    description: "written through DescriptionEditModal, which caps at the schema's own 4096",
  },

  // The create form asks for what a club cannot be entered without; the school type is answered on the
  // club's own page afterwards.
  FLCreateTeamFormPayloadSchema: { schulform: "the create draft sends the null the field allows; no control offers another value" },

  FLPostBewerbungPayloadSchema: {
    saison_id: THE_PAGE_SEASON,
    schule: THE_SCHOOL_ITSELF,
    "kontakte.trainer.einwilligung.text_version": WRITTEN_NOT_PICKED,
    "kontakte.ansprechperson.einwilligung.text_version": WRITTEN_NOT_PICKED,
    "kontakte.stellvertretung.einwilligung.text_version": WRITTEN_NOT_PICKED,
  },

  FLPostSaisonPayloadSchema: {
    "rules.erlaubte_stufen.0": A_STUFE_ROW,
    bewerbung: WINDOW_OPENS_LATER,
    "bewerbung.offen": WINDOW_OPENS_LATER,
    "bewerbung.von": WINDOW_OPENS_LATER,
    "bewerbung.bis": WINDOW_OPENS_LATER,
  },

  FLPostSaisonTeamPayloadSchema: { team_id: IN_THE_PATH, saison_id: THE_PAGE_SEASON },
  // No `kontakte` entry: the junction PATCH does not carry the block, and the sweep fails on a
  // listed path the schema no longer holds.
  FLPatchSaisonTeamPayloadSchema: {
    team_id: IN_THE_PATH,
    saison_id: IN_THE_PATH,
    austritt: RECORD_ITSELF,
  },

  FLPatchSaisonTeamKontaktePayloadSchema: {
    team_id: IN_THE_PATH,
    saison_id: IN_THE_PATH,
    kontakte: RECORD_ITSELF,
    // Each seat is nullable in its own right, so each carries the block's reason one level down.
    "kontakte.trainer": RECORD_ITSELF,
    "kontakte.ansprechperson": RECORD_ITSELF,
    "kontakte.stellvertretung": RECORD_ITSELF,
    "kontakte.trainer.einwilligung.umfang": ONE_SCOPE,
    "kontakte.ansprechperson.einwilligung.umfang": ONE_SCOPE,
    "kontakte.stellvertretung.einwilligung.umfang": ONE_SCOPE,
  },
  FLReplaceSaisonTeamPayloadSchema: {
    team_id: IN_THE_PATH,
    saison_id: IN_THE_PATH,
    incoming_team_id: "picked from clubs the panel already graded, each id off a parsed record",
  },

  FLPostSaisonSpielerPayloadSchema: {
    spieler_id: IN_THE_PATH,
    saison_id: THE_PAGE_SEASON,
    is_nachgetragen: "derived from the season's status, never asked",
  },
  FLPatchSaisonSpielerPayloadSchema: {
    spieler_id: IN_THE_PATH,
    saison_id: IN_THE_PATH,
    is_nachgetragen: "round-tripped read-only: a historical fact about the entry, not an editable field",
  },
  FLCreateSpielerFormPayloadSchema: {
    is_nachgetragen: "derived from the chosen season's status, never asked",
    rolle: "hardcoded null: a squad role is decided on the player's own page, on an existing squad",
  },

  FLSwapGruppenPayloadSchema: {
    saison_id: IN_THE_PATH,
    team1_id: "the page's own club, or the season editor's first pick — never typed",
    team2_id: "picked from clubs the swap already graded, each id off a parsed record",
  },

  FLPatchSpielDataPayloadSchema: {
    spiel_id: IN_THE_PATH,
    ort: RECORD_ITSELF,
    schiedsrichter: RECORD_ITSELF,
    team1: RECORD_ITSELF,
    team2: RECORD_ITSELF,
    team1_quelle: RECORD_ITSELF,
    team2_quelle: RECORD_ITSELF,
    elfmeterschiessen: RECORD_ITSELF,
    "team1_quelle.ausgang": "the `_quelle.type` picker owns it: Sieger and Verlierer are two of its rows",
    "team2_quelle.ausgang": "the `_quelle.type` picker owns it: Sieger and Verlierer are two of its rows",
  },
};

/**
 * A payload schema parsed in a ROUTE HANDLER rather than a server action. Discovering only from a slice's
 * `actions.ts` leaves the public application form swept by nothing, so each one here names its form.
 */
const routeParsed = new Map<string, string>();
for (const [file, text] of sources) {
  if (!/^app\/api\/.*route\.ts$/.test(file)) continue;
  for (const match of text.matchAll(/(FL\w+PayloadSchema)\.safeParse/g)) {
    if (match[1] !== undefined) routeParsed.set(match[1], file);
  }
}

/** Schema → the slice holding it and the form entry that renders its inputs. */
const ROUTE_FORMS: Record<string, { slice: string; form: string }> = {
  FLPostBewerbungPayloadSchema: {
    slice: "bewerbungen",
    form: "features/bewerbungen/components/forms/BewerbungForm/BewerbungForm.tsx",
  },
};

const sweptSchemas = [...schemaActions.keys()].sort();

describe("every payload path a refusal can name", () => {
  it("is swept, and the sweep found the payload schemas at all", () => {
    // Floors, not exact counts: they guard a discovery that silently finds nothing after a rename,
    // which would leave every case below vacuous.
    assert.ok(actionSlice.size >= 25, `expected at least 25 server actions, found ${String(actionSlice.size)}`);
    assert.ok(sweptSchemas.length >= 20, `expected at least 20 parsed payload schemas, found ${String(sweptSchemas.length)}`);
    assert.ok(components.length >= 150, `expected at least 150 components, found ${String(components.length)}`);
  });

  it("resolves every helper a name is built by", () => {
    // Unlisted, a helper's names are simply absent from `renderedNames`, and every path it renders then
    // reads as unrendered — or, worse, is quietly exempted to make the sweep pass.
    for (const helper of calledHelpers()) {
      assert.ok(helper in NAME_CALL_BINDINGS, `a name is built by \`${helper}()\`, which NAME_CALL_BINDINGS does not bind`);
    }
  });

  it("resolves every identifier a templated name interpolates", () => {
    for (const identifier of templateIdentifiers()) {
      assert.ok(
        identifier in NAME_TEMPLATE_BINDINGS,
        `a name template interpolates \`${identifier}\`, which NAME_TEMPLATE_BINDINGS does not bind`,
      );
    }
  });

  it("exempts no schema the sweep does not reach", () => {
    for (const schema of Object.keys(EXEMPT)) {
      assert.ok(sweptSchemas.includes(schema) || schema in ROUTE_FORMS, `${schema} is exempted but nothing parses it — drop the entry`);
    }
  });

  it("knows a form for every payload a route handler parses", () => {
    // Both directions: a new route-parsed schema fails until it names its form, and a stale entry fails
    // once nothing parses it. Neither can be satisfied by the sweep quietly finding less.
    assert.deepEqual([...routeParsed.keys()].sort(), Object.keys(ROUTE_FORMS).sort());
  });

  for (const [schema, { slice, form }] of Object.entries(ROUTE_FORMS)) {
    it(`${schema} renders an input for, or exempts, each of them`, async () => {
      const schemaModule: Record<string, unknown> = await import(pathToFileURL(path.join(SRC_DIR, "features", slice, "schemas.ts")).href);
      const rendered = renderedNames(importTree([form]));
      const exempt = EXEMPT[schema] ?? {};
      const paths = payloadPaths(z.toJSONSchema(schemaModule[schema] as z.ZodType, { io: "input" }) as JsonSchema);

      assert.ok(paths.length > 0, `${schema} reduced to no paths at all`);
      assert.deepEqual(
        paths.filter((field) => !rendered.has(field) && !(field in exempt)),
        [],
        `${schema} names paths no input renders. Give each a \`name\`, or add it to EXEMPT with the reason.`,
      );
    });
  }

  for (const schema of sweptSchemas) {
    it(`${schema} renders an input for, or exempts, each of them`, async () => {
      const actions = schemaActions.get(schema) ?? [];
      const slice = actionSlice.get(actions[0] ?? "") ?? "";
      const schemaModule: Record<string, unknown> = await import(pathToFileURL(path.join(SRC_DIR, "features", slice, "schemas.ts")).href);

      const callers = callersOf(actions);
      assert.ok(callers.length > 0, `nothing calls ${actions.join(" or ")}, so ${schema}'s form cannot be found`);

      const rendered = renderedNames(importTree(callers));
      const exempt = EXEMPT[schema] ?? {};
      const paths = payloadPaths(z.toJSONSchema(schemaModule[schema] as z.ZodType, { io: "input" }) as JsonSchema);
      assert.ok(paths.length > 0, `${schema} reduced to no paths at all`);

      // Collected, not asserted one at a time, so a payload that grew several fields reports them
      // all in one run.
      const undisplayable = paths.filter((field) => !rendered.has(field) && !(field in exempt));
      assert.deepEqual(
        undisplayable,
        [],
        `${schema} can be refused on ${undisplayable.join(", ")}, and ${callers.join(", ")} renders no input for any of them. ` +
          `Give each a \`name\`, or add it to EXEMPT with the reason it is unreachable.`,
      );
      for (const field of Object.keys(exempt)) {
        assert.ok(paths.includes(field), `${schema}.${field} is exempted but is no longer a path of the payload — drop the entry`);
      }
    });
  }
});

describe("every path a refusal mapper emits", () => {
  /**
   * The half `toFieldErrors` cannot cover: a 409 carries a CODE, and code-to-field is a literal.
   * Read as text because a `"use server"` module exports only async functions, so it cannot be
   * imported and asked.
   */
  const production = [...sources].filter(([file]) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"));

  /**
   * A mapper by its RETURN TYPE, which is what a module writing one cannot avoid declaring. Anchored on
   * `):` so a type alias and an interface field, which declare the shape without answering in it, are not one.
   */
  const DECLARES_FIELD_ERRORS = /\)\s*:\s*(?:Promise<)?\{[^{}]*fieldErrors\?:\s*FieldErrors/;
  // A code in a COMPARISON, never anywhere in the file: one quoted in prose above an unrelated
  // function would otherwise make that file a mapper owing an excuse.
  const NAMES_A_REFUSAL_CODE = /(?:case|===)\s*"REQ-[A-Z]+-\d+"/;

  /**
   * What each `fieldErrors` assignment's value is made of, which is what decides whether this half can
   * read it (`docs/frontend/spec.md` §1.9). The `?` is what separates a declaration from a filling.
   */
  const FORWARDED = /^\w+\.fieldErrors\b/;

  function fieldErrorAssignments(text: string): { literals: number; opaque: number } {
    let literals = 0;
    let opaque = 0;

    for (const assignment of text.matchAll(/fieldErrors:\s*/g)) {
      const value = text.slice(assignment.index + assignment[0].length);
      if (value.startsWith("{")) literals++;
      else if (!value.startsWith("toFieldErrors(") && !FORWARDED.test(value)) opaque++;
    }
    return { literals, opaque };
  }

  const declaredMappers = production.filter(([, text]) => DECLARES_FIELD_ERRORS.test(text) && NAMES_A_REFUSAL_CODE.test(text));

  /**
   * The source between one `{` and the `}` closing it, scanned with depth so a brace inside a value
   * cannot end the body early. A regex ends at the `}` inside `vor ${x}`, and every key written after
   * it is then invisible.
   */
  function objectBodyAt(text: string, open: number): string {
    let depth = 0;
    let quote: string | null = null;

    for (let index = open; index < text.length; index++) {
      const character = text[index];
      if (quote !== null) {
        if (character === "\\") index++;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") quote = character;
      else if (character === "{") depth++;
      else if (character === "}" && --depth === 0) return text.slice(open + 1, index);
    }
    return "";
  }

  /** One body's own entries, split at ITS depth: a nested object's commas belong to that object. */
  function topLevelParts(body: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    let start = 0;

    for (let index = 0; index < body.length; index++) {
      const character = body[index];
      if (quote !== null) {
        if (character === "\\") index++;
        else if (character === quote) quote = null;
        continue;
      }
      if (character === '"' || character === "'" || character === "`") quote = character;
      else if (character === "(" || character === "[" || character === "{") depth++;
      else if (character === ")" || character === "]" || character === "}") depth--;
      else if (character === "," && depth === 0) {
        parts.push(body.slice(start, index));
        start = index + 1;
      }
    }
    parts.push(body.slice(start));
    return parts;
  }

  /**
   * Every path one module maps a refusal onto.
   *
   * Not read: a computed key, a spread, and a map built somewhere else and named here. The last of
   * those is not a silent gap — a mapper that assigns `fieldErrors` and yields no key fails below.
   */
  function emittedKeys(text: string): string[] {
    const keys: string[] = [];
    for (const assignment of text.matchAll(/fieldErrors:\s*\{/g)) {
      const open = assignment.index + assignment[0].length - 1;
      for (const part of topLevelParts(objectBodyAt(text, open))) {
        const key = /^\s*"?([\w.]+)"?\s*:/.exec(part)?.[1];
        if (key !== undefined) keys.push(key);
      }
    }
    return keys;
  }

  /** Keyed by FILE rather than by slice: a slice may hold two mappers, and each answers for its own paths. */
  const emitted = new Map<string, string[]>();
  for (const [file, text] of production) {
    const keys = emittedKeys(text);
    if (keys.length > 0) emitted.set(file, [...new Set(keys)]);
  }

  /**
   * A mapper whose whole answer is a banner. **Each entry is a decision, not a backlog row**, and no
   * way out of the sweep: a listed file that assigns `fieldErrors` at all fails below.
   */
  const BANNER_ONLY: Record<string, string> = {
    "features/schiedsrichter/actions.ts":
      "retiring is refused for fixtures still needing a result — a fact about the season, and no control on the form is at fault",
    "features/spielorte/actions.ts": "the same refusal for a venue, and the fixtures it names are on another page entirely",
  };

  /** What a module offers by name, so its callers are found rather than listed. */
  function exportedSymbols(text: string): string[] {
    const names = [
      ...[...text.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((match) => match[1]),
      ...[...text.matchAll(/export\s+const\s+(\w+)/g)].map((match) => match[1]),
    ];
    return names.filter((name) => name !== undefined);
  }

  /** `app/api/bewerbung/route.ts` answers at `/api/bewerbung`: a handler's URL is its own path. */
  const routeUrl = (file: string): string => `/${file.replace(/^app\//, "").replace(/\/route\.ts$/, "")}`;

  /**
   * The forms a mapper's paths can land on: whatever calls it, plus — where a ROUTE HANDLER calls it —
   * whatever fetches that handler's URL. The public form reaches its refusals only through the second.
   */
  function audienceOf(file: string): string[] {
    const symbols = exportedSymbols(sources.get(file) ?? "");
    const callers = [...sources]
      .filter(([other, text]) => other !== file && symbols.some((symbol) => text.includes(`${symbol}(`)))
      .map(([other]) => other);

    const urls = callers.filter((caller) => /^app\/api\/.*route\.ts$/.test(caller)).map(routeUrl);
    const fetchers = components.filter((component) => urls.some((url) => (sources.get(component) ?? "").includes(`fetch("${url}"`)));

    return [...new Set([...callers.filter((caller) => caller.endsWith(".tsx")), ...fetchers])];
  }

  it("is found by the sweep at all", () => {
    // Floors on the SIGNATURE sweep, which the emission regex does not get to choose: renaming the
    // emitted key empties `emitted` and leaves these standing, so the equality below is what fails.
    const declaredFunctions = production.reduce(
      (sum, [, text]) => sum + (text.match(new RegExp(DECLARES_FIELD_ERRORS.source, "g")) ?? []).length,
      0,
    );
    // Two under the population, whose members are one mapper per slice: the equality below grades
    // each file, so this floor only has to refuse a sweep that collapsed.
    assert.ok(declaredMappers.length >= 7, `expected at least 7 modules mapping a refusal, found ${String(declaredMappers.length)}`);
    assert.ok(
      declaredFunctions >= 40,
      `expected at least 40 functions declared to answer with field errors, found ${String(declaredFunctions)}`,
    );

    // And a floor on the EMISSION route, which the signature floors above say nothing about:
    // narrowing key extraction to the first of each literal leaves both of those standing.
    const paths = [...emitted.values()].reduce((sum, keys) => sum + keys.length, 0);
    assert.ok(paths >= 12, `expected at least 12 hand-written field paths across the mappers, found ${String(paths)}`);
  });

  it("reads every key of a literal, whatever the value before it is made of", () => {
    /* The reader on input rather than on the tree, for the reason `docs/frontend/spec.md` §1.9 gives:
       every literal here holds ONE key, so no count over them separates a correct reader from a
       truncating one. */
    const sample =
      'return { fieldErrors: { beginn: `vor ${String(x)}`, "schule.shorthand": "b", nested: { verborgen: "c" } } };\n' +
      'return { fieldErrors: { zweite: "d" } };';

    assert.deepEqual(emittedKeys(sample), ["beginn", "schule.shorthand", "nested", "zweite"]);
  });

  it("emits from every mapper that names a field, and from nothing else", () => {
    // Two independent signals, compared both ways: a mapper written outside `actions.ts` fails until it
    // is swept, and a narrowed emission regex fails here rather than quietly sweeping less.
    assert.deepEqual(
      [...emitted.keys()].sort(),
      declaredMappers.map(([file]) => file).filter((file) => !(file in BANNER_ONLY)),
      "a module emitting field errors is not one the signature sweep found, or a mapper stopped emitting. Sweep it, or excuse it in BANNER_ONLY with the reason.",
    );

    // The reverse check `EXEMPT` has and this list lacked. Without it, an emission moved behind a
    // constant drops out of `emitted`, and the equality above then names BANNER_ONLY as the remedy.
    for (const [file, reason] of Object.entries(BANNER_ONLY)) {
      assert.ok(
        declaredMappers.some(([found]) => found === file),
        `${file} is excused as banner-only but maps no refusal any more — drop the entry`,
      );

      const { literals, opaque } = fieldErrorAssignments(sources.get(file) ?? "");
      assert.equal(literals + opaque, 0, `${file} is excused as banner-only (${reason}) and names a field after all`);
    }

    // A map this cannot read is the shape the excuse above would otherwise absorb: it drops out of
    // `emitted`, and the equality then names BANNER_ONLY as the remedy. Named here instead.
    for (const [file, text] of declaredMappers) {
      const { opaque } = fieldErrorAssignments(text);
      assert.equal(opaque, 0, `${file} builds its field map somewhere this sweep cannot follow — write the map where the refusal is decided`);
    }
  });

  it("reaches the form behind a route handler, and not only the callers a component names", () => {
    // The refusals arrive through a POST, so the handler's URL is the only thing tying the mapper to the
    // fields it names — and the direct-caller route reaching the same form today is a coincidence.
    const handlers = [...emitted.keys()].flatMap((file) =>
      exportedSymbols(sources.get(file) ?? "").length === 0
        ? []
        : [...sources]
            .filter(
              ([other, text]) =>
                /^app\/api\/.*route\.ts$/.test(other) && exportedSymbols(sources.get(file) ?? "").some((symbol) => text.includes(`${symbol}(`)),
            )
            .map(([other]) => [file, other] as const),
    );

    assert.ok(handlers.length > 0, "no route handler calls a mapper, so the bridge below is proving nothing");
    for (const [file, handler] of handlers) {
      const fetchers = components.filter((component) => (sources.get(component) ?? "").includes(`fetch("${routeUrl(handler)}"`));
      assert.ok(
        fetchers.length > 0,
        `${handler} maps ${file}'s refusals and nothing fetches ${routeUrl(handler)} -- the form showing them cannot be found`,
      );
    }
  });

  for (const [file, paths] of emitted) {
    it(`${file} names only fields its own forms render`, () => {
      const audience = audienceOf(file);
      assert.ok(audience.length > 0, `nothing reaches ${file}, so the forms showing its refusals cannot be found`);

      const rendered = renderedNames(importTree(audience));
      for (const field of paths) {
        assert.ok(
          rendered.has(field),
          `${file} reports on \`${field}\`, which no form reaching it renders. ` +
            `A refusal mapped onto an unrendered path is discarded in silence.`,
        );
      }
    });
  }
});
