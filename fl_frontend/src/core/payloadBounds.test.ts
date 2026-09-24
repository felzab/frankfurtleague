import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { publishedCeilings, readPublishedDocument, requestComponents } from "@/core/publishedCeilings.ts";
import { filesUnder } from "@/core/treeWalk.ts";

import type { PublishedCeiling } from "@/core/publishedCeilings.ts";
import type { ZodType } from "zod";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

const document = readPublishedDocument();

/*
 Read off the document, never listed: the ceiling added next is the one nobody would list. Responses
 stay out, as a read mirror refusing a stored value past a ceiling reports a landed read as failed.
*/
const PAYLOADS = [...requestComponents(document)].sort();

const mirrors = new Map<string, ZodType>();
for (const file of filesUnder(SRC_DIR, (name) => name === "schemas.ts", 8).sort()) {
  const loaded: Record<string, unknown> = await import(pathToFileURL(file).href);
  for (const [name, value] of Object.entries(loaded)) {
    if (name.endsWith("Schema") && typeof value === "object" && value !== null && "_zod" in value) {
      mirrors.set(name.slice(0, -"Schema".length), value as ZodType);
    }
  }
}

const CEILINGS = publishedCeilings(document, PAYLOADS);

/** Every keyword that caps a value from above, read by this walk whether or not the reader reads it. */
const BOUND_KEYWORDS = new Set(["maxLength", "maxItems", "maximum", "exclusiveMaximum", "maxProperties"]);

/*
 PRE-4's second listing (`docs/_standard/standard.md`): the reader lists only what it reads, so this
 walks each payload whole, `items`, `allOf` and nested `anyOf` included, and into a `$ref` whose
 target carries no fields of its own.
*/
function everyBound(component: string): string[] {
  const found: string[] = [];
  const schemas = document.components.schemas;

  const walk = (node: unknown, where: string[], followed: ReadonlySet<string>) => {
    if (Array.isArray(node)) return node.forEach((item, index) => walk(item, [...where, String(index)], followed));
    if (typeof node !== "object" || node === null) return;

    for (const [key, value] of Object.entries(node)) {
      if (BOUND_KEYWORDS.has(key) && typeof value === "number") found.push([...where, key].join("."));
      else if (key === "$ref" && typeof value === "string") {
        const target = value.replace("#/components/schemas/", "");
        if (!followed.has(target) && schemas[target]?.properties === undefined)
          walk(schemas[target], [...where, "$ref"], new Set([...followed, target]));
      } else walk(value, [...where, key], followed);
    }
  };

  walk(schemas[component], [], new Set([component]));

  return found.map((where) => `${component}.${where}`);
}

const location = ({ component, field, keyword, at }: PublishedCeiling): string =>
  [component, "properties", field, ...(at === "" ? [] : [at]), keyword].join(".");

type Capped = PublishedCeiling & { within: unknown; over: unknown };

/**
 * Values of an exact length in the shapes these payloads take: `"a".repeat(301)` is refused by a URL
 * field whatever its ceiling, so it would pass this file with `.max()` deleted. Only a value the
 * mirror otherwise accepts shows the ceiling.
 */
const FILLERS: { min: number; build: (length: number) => string }[] = [
  { min: 1, build: (length) => "a".repeat(length) },
  // A season id is a year the league can play, which no run of one character is.
  { min: 4, build: (length) => String(new Date().getFullYear()).padStart(length, "1") },
  // The length goes into the path: `z.regexes.domain` caps a whole host at 253 characters, below a URL's ceiling.
  { min: 20, build: (length) => `https://beispiel.de/${"a".repeat(length - 20)}` },
  { min: 13, build: (length) => `${"a".repeat(length - 12)}@beispiel.de` },
];

/** Whether the mirror leaves this field unfaulted — the object around it is partial, so only its own path counts. */
function fieldAccepts(component: string, field: string, value: unknown): boolean {
  const result = mirrors.get(component)?.safeParse({ [field]: value });

  return result !== undefined && (result.success || result.error.issues.every((issue) => issue.path.join(".") !== field));
}

/**
 * A published ceiling its mirror leaves to the backend on purpose, each with the line that says why.
 * Held both ways below, so an entry outliving its reason fails rather than exempting a field forever.
 */
const UNMIRRORED: Record<string, string> = {
  "FLSubjektPayload.email": "`fl_frontend/src/core/schemas.ts :: FLSubjektPayloadSchema` restates no length or alphabet",
  // No person sends these three: each list is the server's own earlier answer relayed back.
  "FLBewerbungSweepAngekuendigtPayload.bewerbung_ids":
    "`fl_frontend/src/features/bewerbungen/sweep.ts :: sweepBewerbungen` sends ids from the listing `fl_backend/app/api/bewerbungen/sweep_router.py :: sweep_saison` caps at this number",
  "FLBewerbungSweepLoeschenPayload.bewerbung_ids":
    "`fl_frontend/src/features/bewerbungen/sweep.ts :: sweepBewerbungen` sends ids from the listing `fl_backend/app/api/bewerbungen/sweep_router.py :: sweep_saison` caps at this number",
  "FLPatchSpielePaarungenPayload.paarungen":
    "the undo replays one save's report, never more fixtures than a season holds (`fl_backend/app/api/spiele/schemas.py :: FLPatchSpielePaarungenPayload`)",
};

// Item-agnostic on purpose: an item's own refusal lands on a path below the field's, which `fieldAccepts` ignores.
const listOf = (length: number): unknown[] => Array.from({ length }, () => "0".repeat(24));

// One past the ceiling and one at it, in the shape the field takes.
const capped: Capped[] = CEILINGS.map((ceiling) => {
  const { component, field, keyword, bound } = ceiling;

  if (keyword === "maximum") return { ...ceiling, within: bound, over: bound + 1 };
  if (keyword === "maxItems") return { ...ceiling, within: listOf(bound), over: listOf(bound + 1) };

  const filler = FILLERS.find((candidate) => candidate.min <= bound && fieldAccepts(component, field, candidate.build(bound)));

  return { ...ceiling, within: filler?.build(bound) ?? null, over: filler === undefined ? null : filler.build(bound + 1) };
});

describe("every ceiling a published payload states is one its mirror refuses", () => {
  it("finds a mirror for every payload a request body reaches", () => {
    // The population is read off the document, and the mirrors off the tree: a payload without one
    // would otherwise drop out of the sweep rather than fail it.
    assert.deepEqual(
      PAYLOADS.filter((component) => !mirrors.has(component)),
      [],
    );
  });

  it("finds the payloads and the capped fields to judge", () => {
    // Anti-vacuity: a walk that stopped reaching request bodies, or a document that stopped
    // publishing bounds, would otherwise leave every case below true of an empty list.
    assert.ok(PAYLOADS.length >= 50, `expected at least 50 payload components, found ${String(PAYLOADS.length)}`);
    assert.ok(capped.length >= 60, `expected at least 60 capped fields, found ${String(capped.length)}`);
  });

  it("reads every bound a payload publishes, wherever inside it the bound sits", () => {
    // A bound the reader cannot see is a field that drops out of the sweep while the run stays green.
    assert.deepEqual(PAYLOADS.flatMap(everyBound).sort(), CEILINGS.map(location).sort());
  });

  it("judges each of them with a value its own shape accepts", () => {
    // Without this, a field whose shape no filler fits is still swept and still passes — refused at the
    // ceiling and past it alike, for a reason that is not the ceiling.
    assert.deepEqual(
      capped.filter(({ within }) => within === null).map(({ component, field }) => `${component}.${field}`),
      [],
    );
  });

  it("exempts only published ceilings its mirror still leaves unrefused", () => {
    const stale = Object.keys(UNMIRRORED).filter((key) => {
      const entry = capped.find(({ component, field }) => `${component}.${field}` === key);

      return entry === undefined || !fieldAccepts(entry.component, entry.field, entry.over);
    });

    assert.deepEqual(stale, [], "the document no longer publishes these ceilings, or their mirrors now refuse past them");
  });

  for (const { component, field, keyword, within, over } of capped) {
    if (`${component}.${field}` in UNMIRRORED) continue;

    it(`${component}.${field} is refused one past its ${keyword}`, () => {
      // Parsed, never compared as a number: what matters is that the person is told at the keystroke,
      // and only the schema actually refusing does that.
      const result = mirrors.get(component)?.safeParse({ [field]: over });

      assert.ok(result !== undefined && !result.success, `${component}.${field} accepted a value past its ceiling`);
      assert.ok(
        result.error.issues.some((issue) => issue.path.join(".") === field),
        `${component}.${field} is over its ceiling and the refusal names another field`,
      );
    });

    it(`${component}.${field} is accepted at its ${keyword}`, () => {
      // The half that makes the case above about the CEILING: a field refused at its own limit is one
      // the mirror bounds tighter than the backend publishes, and the person is stopped early.
      assert.ok(fieldAccepts(component, field, within), `${component}.${field} is refused at the ceiling the backend publishes`);
    });
  }
});
