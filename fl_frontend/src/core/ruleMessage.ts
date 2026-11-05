// Apart from the Zod map, which `instrumentation.ts` installs on both runtimes: the rule phrases are the server's
// own catalogue, which neither instrumentation bundle is to carry.
import { COPY } from "./copy";
import { dayOf } from "./format";
import { SERVER_COPY } from "./serverCopy";

import type { Copy } from "./copy";
import type { FLRefusedField } from "./generated/client/types";

const { field, failure } = COPY.shared;

type Context = FLRefusedField["ctx"];

/** A span's end: earliest its start, which the backend's rule names, as the end box's own earliest day reads. */
const notBeforeStart = ({ start }: Context) => (typeof start === "string" ? field.earliest(dayOf(start)) : undefined);

/**
 * Each rule the backend refuses a payload with that a field pattern words, by its kind, from the bounds the rule's
 * context carries: the same line the box shows where the form's own check catches the value
 * (`fl_frontend/src/core/zodGerman.ts :: fieldMessage`).
 */
const PATTERNED = {
  // A season's id is its year, which takes no thousands separator.
  saison_year_out_of_range: ({ min, max }: Context) =>
    typeof min === "number" && typeof max === "number" ? field.between({ year: min }, { year: max }) : undefined,
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
  // A rule over the contact block, which the backend reports at the block; the kind says which field repeats.
  kontakt_email_twice: () => field.taken,
  kontakt_telefon_twice: () => field.taken,
  // A no-show's report carries no play: the league composes its goals, and nobody scored them.
  nichtantreten_with_tore: () => field.without(COPY.shared.tore),
  nichtantreten_with_torschuetzen: () => field.without(COPY.admin.spiel.torschuetzen),
} satisfies Readonly<Record<string, (context: Context) => Copy | undefined>>;

/** Every rule a refused payload can name that the catalogue words: by a pattern, or by `SERVER_COPY.ruleLine`'s sentence. */
export type WordedRule = keyof typeof PATTERNED | keyof typeof SERVER_COPY.ruleLine;

const isPatterned = (kind: string): kind is keyof typeof PATTERNED => Object.hasOwn(PATTERNED, kind);
const isLined = (kind: string): kind is keyof typeof SERVER_COPY.ruleLine => Object.hasOwn(SERVER_COPY.ruleLine, kind);

/** Whether the catalogue words this rule, so a screen may place it. */
export const isWordedRule = (kind: string): kind is WordedRule => isPatterned(kind) || isLined(kind);

/**
 * A rule the backend refused a payload with: under its field, in the same fixed patterns a Zod issue's line takes, or,
 * where no pattern words it, as the rule's sentence on the status line. A context missing the bound its rule names
 * means a page older than the API, so it answers the unexpected line on the status line, as any rule the catalogue
 * does not word does.
 */
export function ruleMessage({ kind, ctx }: Pick<FLRefusedField, "kind" | "ctx">): { field: Copy } | { line: Copy } {
  if (isPatterned(kind)) {
    const phrase = PATTERNED[kind](ctx);
    return phrase === undefined ? { line: failure.unexpected } : { field: phrase };
  }
  if (isLined(kind)) return { line: SERVER_COPY.ruleLine[kind] };
  return { line: failure.unexpected };
}
