import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import z from "zod";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

function collectSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectSources(full);
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [full] : [];
  });
}

const sources = new Map(
  collectSources(SRC_DIR).map((file) => [path.relative(SRC_DIR, file).split(path.sep).join("/"), readFileSync(file, "utf8")]),
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
  namePrefix: ["address"],
  // The draw renders its three shape fields from one table, so these paths resolve only here.
  shapeKey: ["number_of_groups", "teams_per_group", "qualifiers_per_group"],
};

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

  const properties = node.properties as Record<string, JsonSchema> | undefined;
  if (properties === undefined) return prefix === "" ? [] : [prefix];

  return Object.entries(properties).flatMap(([key, value]) => payloadPaths(value, prefix === "" ? key : `${prefix}.${key}`));
}

const IN_THE_PATH = "in the request URI, off an already-parsed record — no input, and no refusal names it";
const THE_PAGE_SEASON = "the page's selected season, parsed at `.length(4)` before the control renders";

const NO_FORM_AT_ALL = "a row button's whole argument: an id in the path, no request body, no form";

/** The draw is the one payload here with a body and still no field: its confirmation is an escalation, not an input. */
const DRAW_HAS_NO_FIELDS = "the draw's panel: the season is in the path and the replace is a two-press escalation, neither being an input";

/** A panel rather than a row button, as the erasure's is. */
const ANONYMISATION_HAS_NO_FIELDS =
  "the anonymisation's panel: the id is in the path and the confirmation is a two-press escalation, neither being an input";

/** A panel rather than a row button, which is why `NO_FORM_AT_ALL` would read wrong beside it. */
const ERASURE_HAS_NO_FIELDS =
  "the erasure's panel: the id is in the path and the confirmation is a two-press escalation, neither being an input";

/** The draw's own sibling, and a panel rather than a row button for the same reason. */
const UNDRAW_HAS_NO_FIELDS =
  "the undraw's panel: the season is in the path and the confirmation is a two-press escalation, neither being an input";

/**
 * A nullable object is refused on its own path only for a value that is neither the object nor
 * `null` — a shape the typed payload builders cannot produce. Its fields are swept individually.
 */
const RECORD_ITSELF = "the record's own path: refusable only on a shape the typed payload cannot build";

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
  FLAnonymiseSchiedsrichterPayloadSchema: { id: ANONYMISATION_HAS_NO_FIELDS },
  FLDeleteTeamPayloadSchema: { id: NO_FORM_AT_ALL },
  FLReactivateSpielerPayloadSchema: { id: NO_FORM_AT_ALL },
  FLReactivateTeamPayloadSchema: { id: NO_FORM_AT_ALL },
  FLSchiedsrichterKeyPayloadSchema: { id: NO_FORM_AT_ALL },
  FLSpielortKeyPayloadSchema: { id: NO_FORM_AT_ALL },
  FLSaisonSpielerKeyPayloadSchema: { spieler_id: NO_FORM_AT_ALL, saison_id: NO_FORM_AT_ALL },

  FLPatchSaisonPayloadSchema: { id: IN_THE_PATH },
  FLPatchSchiedsrichterPayloadSchema: { id: IN_THE_PATH },
  FLPatchSpielerPayloadSchema: { id: IN_THE_PATH },
  FLPatchSpielortPayloadSchema: { id: IN_THE_PATH },
  FLPatchSpieltagPayloadSchema: { id: IN_THE_PATH },

  FLPatchTeamPayloadSchema: {
    id: IN_THE_PATH,
    description: "written through DescriptionEditModal, which caps at the schema's own 4096",
  },

  FLPostSaisonTeamPayloadSchema: { team_id: IN_THE_PATH, saison_id: THE_PAGE_SEASON },
  FLPatchSaisonTeamPayloadSchema: { team_id: IN_THE_PATH, saison_id: IN_THE_PATH, austritt: RECORD_ITSELF },
  FLReplaceSaisonTeamPayloadSchema: {
    team_id: IN_THE_PATH,
    saison_id: IN_THE_PATH,
    incoming_team_id: "picked from clubs the panel already graded, each id off a parsed record",
  },

  FLPostSaisonSpielerPayloadSchema: {
    spieler_id: IN_THE_PATH,
    saison_id: THE_PAGE_SEASON,
    is_nachgetragen: "derived from the season's status, never asked (decided 2026-08-07)",
  },
  FLPatchSaisonSpielerPayloadSchema: {
    spieler_id: IN_THE_PATH,
    saison_id: IN_THE_PATH,
    is_nachgetragen: "round-tripped read-only: a historical fact about the entry, not an editable field",
  },
  FLCreateSpielerFormPayloadSchema: {
    is_nachgetragen: "derived from the chosen season's status, never asked (decided 2026-08-07)",
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

const sweptSchemas = [...schemaActions.keys()].sort();

describe("every payload path a refusal can name", () => {
  it("is swept, and the sweep found the payload schemas at all", () => {
    // Floors, not exact counts: they guard a discovery that silently finds nothing after a rename,
    // which would leave every case below vacuous.
    assert.ok(actionSlice.size >= 25, `expected at least 25 server actions, found ${String(actionSlice.size)}`);
    assert.ok(sweptSchemas.length >= 20, `expected at least 20 parsed payload schemas, found ${String(sweptSchemas.length)}`);
    assert.ok(components.length >= 150, `expected at least 150 components, found ${String(components.length)}`);
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
      assert.ok(sweptSchemas.includes(schema), `${schema} is exempted but no action parses it — drop the entry`);
    }
  });

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
  const emitted = new Map<string, string[]>();
  for (const [file, text] of sources) {
    if (!/^features\/[^/]+\/actions\.ts$/.test(file)) continue;
    // Every key of the literal, not just the first: a refusal naming two fields must have both swept.
    const keys = [...text.matchAll(/fieldErrors:\s*\{([^}]*)\}/g)]
      .flatMap((literal) => [...(literal[1] ?? "").matchAll(/"?([\w.]+)"?\s*:/g)].map((entry) => entry[1]))
      .filter((key) => key !== undefined);
    if (keys.length > 0) emitted.set(sliceOf(file), [...new Set(keys)]);
  }

  it("is found by the sweep at all", () => {
    const total = [...emitted.values()].reduce((sum, paths) => sum + paths.length, 0);
    assert.ok(emitted.size >= 4, `expected at least 4 slices mapping a refusal onto a field, found ${String(emitted.size)}`);
    assert.ok(total >= 8, `expected at least 8 hand-written field paths, found ${String(total)}`);
  });

  for (const [slice, paths] of emitted) {
    it(`${slice} names only fields its own forms render`, () => {
      const actions = [...actionSlice].filter(([, owner]) => owner === slice).map(([action]) => action);
      const rendered = renderedNames(importTree(callersOf(actions)));

      for (const field of paths) {
        assert.ok(
          rendered.has(field),
          `features/${slice}/actions.ts reports on \`${field}\`, which no form calling its actions renders. ` +
            `A refusal mapped onto an unrendered path is discarded in silence.`,
        );
      }
    });
  }
});
