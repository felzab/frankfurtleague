import { z } from "zod";

import { COPY } from "./copy";
import { SERVER_COPY } from "./serverCopy";

import type { Copy } from "./copy";
import type { CalendarDay } from "./format";
import type { FLRefusedField } from "./generated/client/types";

/** A field's example for „Format: {Beispiel}“, keyed by the field's path, its segments joined by dots. */
export type Beispiele = Readonly<Record<string, Copy>>;

const { field, failure } = COPY.shared;

/** A number schema's bounds as JSON Schema states them, the one public reading that keeps a bound's exclusiveness. */
type NumberBounds = { type?: unknown; minimum?: number; exclusiveMinimum?: number; maximum?: number; exclusiveMaximum?: number };

// A bound at the safe integers' edge is an integer's own range, which `z.int()` holds and no rule sets.
const isRuled = (bound: number | undefined): bound is number => bound !== undefined && Math.abs(bound) < Number.MAX_SAFE_INTEGER;

/**
 * A number's line, naming every bound the schema sets as the figure a person can type at it: an integer's exclusive
 * bound moves one step inward. A decimal's exclusive bound has no such figure, so no pattern words it.
 */
function numberMessage(schema: z.core.$ZodType): Copy | undefined {
  const bounds = z.toJSONSchema(schema) as NumberBounds;
  const integer = bounds.type === "integer";
  if (!integer && (bounds.exclusiveMinimum !== undefined || bounds.exclusiveMaximum !== undefined)) return undefined;

  const lower = bounds.exclusiveMinimum === undefined ? bounds.minimum : bounds.exclusiveMinimum + 1;
  const upper = bounds.exclusiveMaximum === undefined ? bounds.maximum : bounds.exclusiveMaximum - 1;
  if (isRuled(lower) && isRuled(upper)) return field.between(lower, upper);
  if (isRuled(lower)) return field.min(lower);
  if (isRuled(upper)) return field.max(upper);
  return undefined;
}

/**
 * The one line a field shows under it for a Zod issue, in the fixed field patterns: what is expected, never the field's
 * name and never „ungültig“. An issue no pattern words, which no person's typing raises, falls to the one unexpected
 * line rather than to Zod's English. It reads the raw issue an error map is handed, whose input and schema a parse's
 * finished issues no longer carry.
 */
export function fieldMessage(issue: z.core.$ZodRawIssue, beispiele: Beispiele = {}): Copy {
  // Every check meeting an empty box asks for a value, whichever check it was; a list with nothing picked is one.
  const { input } = issue;
  if (input === undefined || input === null || input === "" || (Array.isArray(input) && input.length === 0)) return field.required;

  if (issue.code === "too_small" || issue.code === "too_big") {
    const small = issue.code === "too_small";
    if (issue.origin === "string") return small ? field.minChars(Number(issue.minimum)) : field.maxChars(Number(issue.maximum));
    if (issue.origin === "array" || issue.origin === "set") return small ? field.min(Number(issue.minimum)) : field.max(Number(issue.maximum));
    // A number's issue names the one bound it passed; the line names every bound, read off the schema holding them.
    if ((issue.origin === "number" || issue.origin === "int") && issue.schema !== undefined) {
      return numberMessage(issue.schema) ?? failure.unexpected;
    }
  }

  // A value of the wrong shape is shown the shape: the field's own example, or the address example for an address.
  const example = beispiele[(issue.path ?? []).map(String).join(".")];
  if (example !== undefined) return field.format(example);
  if (issue.code === "invalid_format" && issue.format === "email") return field.format(field.exampleAddress);

  return failure.unexpected;
}

type Context = FLRefusedField["ctx"];

/** A span's end: earliest its start, which the backend's rule names, as the end box's own earliest day reads. */
const notBeforeStart = ({ start }: Context) => (typeof start === "string" ? field.earliest(start as CalendarDay) : undefined);

/**
 * Each rule the backend refuses a payload with that a field pattern words, by its kind, from the bounds the rule's
 * context carries: the same line the box shows where the form's own check catches the value.
 */
const PATTERNED = {
  // A season's id is its year, which takes no thousands separator.
  saison_year_out_of_range: ({ min, max }: Context) =>
    typeof min === "number" && typeof max === "number" ? field.between(String(min), String(max)) : undefined,
  saison_ends_before_start: notBeforeStart,
  bewerbung_window_ends_before_start: notBeforeStart,
  registrierung_window_ends_before_start: notBeforeStart,
  spieltag_ends_before_start: notBeforeStart,
  good_spieler_exceed_kader: ({ max }: Context) => (typeof max === "number" ? field.max(max) : undefined),
  // A box left empty that the rule requires once another box is set.
  ergebnis_missing_tore: () => field.required,
  decline_without_proposal: () => field.required,
  decline_without_reason: () => field.required,
  email_not_accepted: () => field.format(field.exampleAddress),
  date_not_in_calendar: () => field.format(field.exampleDate),
  url_not_accepted: () => field.format(field.exampleUrl),
  address_in_free_text: () => field.without(COPY.signIn.address),
  // A rule over the whole list of contact persons, so no box names the repeated value: the line names it.
  kontakt_email_twice: () => COPY.template.namedField(COPY.signIn.address, field.taken),
  kontakt_telefon_twice: () => COPY.template.namedField(COPY.shared.phoneNumber, field.taken),
} satisfies Readonly<Record<string, (context: Context) => Copy | undefined>>;

/** Every rule a refused payload can name that the catalogue words: by a pattern, or by `SERVER_COPY.rule`'s own phrase. */
export type WordedRule = keyof typeof PATTERNED | keyof typeof SERVER_COPY.rule;

const isPatterned = (kind: string): kind is keyof typeof PATTERNED => Object.hasOwn(PATTERNED, kind);
const isPhrased = (kind: string): kind is keyof typeof SERVER_COPY.rule => Object.hasOwn(SERVER_COPY.rule, kind);

/** Whether the catalogue words this rule, so a screen may place it. */
export const isWordedRule = (kind: string): kind is WordedRule => isPatterned(kind) || isPhrased(kind);

/**
 * A rule the backend refused a payload with, in the same fixed patterns a Zod issue's line takes, or in the rule's own
 * phrase where no pattern words it. A context missing the bound its rule names means a page older than the API, so it
 * answers the unexpected line, as any rule the catalogue does not word does.
 */
export function ruleMessage({ kind, ctx }: Pick<FLRefusedField, "kind" | "ctx">): Copy {
  if (isPatterned(kind)) return PATTERNED[kind](ctx) ?? failure.unexpected;
  if (isPhrased(kind)) return SERVER_COPY.rule[kind];
  return failure.unexpected;
}

// Redesign: goes, with its call in `instrumentation.ts`, with the last parse that passes no map of its own, the old
// actions' and route handlers'; `core/action.ts` hands `fieldMessage` to every parse it makes.
/**
 * Makes the map the process's, below every message a schema, a check or a parse names itself, and above Zod's English
 * locale. Called once, from `fl_frontend/src/instrumentation.ts :: register`, before the server serves: Zod keeps its
 * config on `globalThis`, so every copy of Zod a server bundle holds reads it.
 */
export function installGermanMap(): void {
  z.config({ customError: (issue) => fieldMessage(issue) });
}
