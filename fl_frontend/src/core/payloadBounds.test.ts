import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { publishedCeilings, readPublishedDocument, requestComponents } from "@/core/publishedCeilings.ts";
import { filesUnder } from "@/core/treeWalk.ts";

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

type Capped = { component: string; field: string; at: unknown; over: unknown };

/** A host of exactly this many characters: `z.regexes.domain` caps ONE label at 63, so past that it dots. */
function dottedHost(length: number): string {
  const labels: string[] = [];
  let left = length;

  // 61, not 60: leaving exactly zero would append an empty final label and trail the host with a dot.
  while (left > 61) {
    labels.push("a".repeat(60));
    left -= 61;
  }
  labels.push("a".repeat(left));

  return labels.join(".");
}

/**
 * Values of an exact length in the shapes these payloads take: `"a".repeat(301)` is refused by a URL
 * field whatever its ceiling, so it would pass this file with `.max()` deleted. Only a value the
 * mirror otherwise accepts shows the ceiling.
 */
const FILLERS: { min: number; build: (length: number) => string }[] = [
  { min: 1, build: (length) => "a".repeat(length) },
  // A season id is a year the league can play, which no run of one character is.
  { min: 4, build: (length) => String(new Date().getFullYear()).padStart(length, "1") },
  { min: 12, build: (length) => `https://${dottedHost(length - 11)}.de` },
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
};

// One past the ceiling and one at it, in the shape the field takes.
const capped: Capped[] = publishedCeilings(document, PAYLOADS).map(({ component, field, characters, maximum }) => {
  if (characters === null) return { component, field, at: maximum, over: (maximum ?? 0) + 1 };

  const filler = FILLERS.find((candidate) => candidate.min <= characters && fieldAccepts(component, field, candidate.build(characters)));

  return {
    component,
    field,
    at: filler?.build(characters) ?? null,
    over: filler === undefined ? null : filler.build(characters + 1),
  };
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

  it("judges each of them with a value its own shape accepts", () => {
    // Without this, a field whose shape no filler fits is still swept and still passes — refused at the
    // ceiling and past it alike, for a reason that is not the ceiling.
    assert.deepEqual(
      capped.filter(({ at }) => at === null).map(({ component, field }) => `${component}.${field}`),
      [],
    );
  });

  it("exempts only published ceilings its mirror still leaves unrefused", () => {
    const stale = Object.keys(UNMIRRORED).filter((key) => {
      const entry = capped.find(({ component, field }) => `${component}.${field}` === key);

      return entry === undefined || mirrors.get(entry.component)?.safeParse({ [entry.field]: entry.over }).success !== true;
    });

    assert.deepEqual(stale, [], "the document no longer publishes these ceilings, or their mirrors now refuse past them");
  });

  for (const { component, field, at, over } of capped) {
    if (`${component}.${field}` in UNMIRRORED) continue;

    it(`${component}.${field} is refused one past its ceiling`, () => {
      // Parsed, never compared as a number: what matters is that the person is told at the keystroke,
      // and only the schema actually refusing does that.
      const result = mirrors.get(component)?.safeParse({ [field]: over });

      assert.ok(result !== undefined && !result.success, `${component}.${field} accepted a value past its ceiling`);
      assert.ok(
        result.error.issues.some((issue) => issue.path.join(".") === field),
        `${component}.${field} is over its ceiling and the refusal names another field`,
      );
    });

    it(`${component}.${field} is accepted at its ceiling`, () => {
      // The half that makes the case above about the CEILING: a field refused at its own limit is one
      // the mirror bounds tighter than the backend publishes, and the person is stopped early.
      assert.ok(fieldAccepts(component, field, at), `${component}.${field} is refused at the ceiling the backend publishes`);
    });
  }
});
