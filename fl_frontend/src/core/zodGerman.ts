import { z } from "zod";

import { COPY } from "./copy/shared";

import type { Copy } from "./copy";

/** A field's example for „Format: …“, keyed by the field's path, its segments joined by dots. */
export type Examples = Readonly<Record<string, Copy>>;

const { field, failure } = COPY.shared;

/** A number schema's bounds as JSON Schema states them, the one public reading that keeps a bound's exclusiveness. */
type NumberBounds = { minimum?: number; exclusiveMinimum?: number; maximum?: number; exclusiveMaximum?: number };

// A bound at the safe integers' edge is an integer's own range, which `z.int()` holds and no rule sets.
const ruled = (bound: number | undefined): number | undefined =>
  bound !== undefined && Math.abs(bound) < Number.MAX_SAFE_INTEGER ? bound : undefined;

/**
 * A number's line, naming every bound the schema sets as the figure a person can type at it: an exclusive bound moves
 * one step inward, every exclusive bound the API publishes being an integer's.
 */
function numberMessage(schema: z.core.$ZodType): Copy | undefined {
  const bounds = z.toJSONSchema(schema) as NumberBounds;
  const lower = ruled(bounds.exclusiveMinimum === undefined ? bounds.minimum : bounds.exclusiveMinimum + 1);
  const upper = ruled(bounds.exclusiveMaximum === undefined ? bounds.maximum : bounds.exclusiveMaximum - 1);
  if (lower !== undefined && upper !== undefined) return field.between(lower, upper);
  if (lower !== undefined) return field.min(lower);
  if (upper !== undefined) return field.max(upper);
  return undefined;
}

/**
 * The one line a field shows under it for a Zod issue, in the fixed field patterns: what is expected, never the field's
 * name and never „ungültig“. An issue no pattern words, which no person's typing raises, falls to the one unexpected
 * line rather than to Zod's English. It reads the raw issue an error map is handed, whose input and schema a parse's
 * finished issues no longer carry.
 */
export function fieldMessage(issue: z.core.$ZodRawIssue, examples: Examples = {}): Copy {
  // Every check meeting an empty box asks for a value, whichever check it was; a list with nothing picked is one.
  const { input } = issue;
  if (input === undefined || input === null || input === "" || (Array.isArray(input) && input.length === 0)) return field.required;

  if (issue.code === "too_small" || issue.code === "too_big") {
    const small = issue.code === "too_small";
    if (issue.origin === "string") return small ? field.minChars(Number(issue.minimum)) : field.maxChars(Number(issue.maximum));
    if (issue.origin === "array") return small ? field.min(Number(issue.minimum)) : field.max(Number(issue.maximum));
    // A number's issue names the one bound it passed; the line names every bound, read off the schema holding them.
    if ((issue.origin === "number" || issue.origin === "int") && issue.schema !== undefined) {
      return numberMessage(issue.schema) ?? failure.unexpected;
    }
  }

  // A value of the wrong shape is shown the shape: the field's own example, or the address example for an address.
  const example = examples[(issue.path ?? []).map(String).join(".")];
  if (example !== undefined) return field.format(example);
  if (issue.code === "invalid_format" && issue.format === "email") return field.format(field.exampleAddress);

  return failure.unexpected;
}
