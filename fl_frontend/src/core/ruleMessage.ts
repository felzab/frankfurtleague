// Apart from the Zod map, which `instrumentation.ts` installs on both runtimes: the rule phrases are the server's
// own catalogue, which neither instrumentation bundle is to carry.
import { now } from "./clock";
import { COPY } from "./copy";
import { dayIn, dayOf } from "./format";
import { saisonsPatchSaisonBodyRulesDrawPointsMin } from "./generated/zod/inputs";
import { SERVER_COPY } from "./serverCopy";

import type { Copy } from "./copy";
import type { CalendarDay } from "./format";
import type { Code, FLRefusedField, Rule } from "./generated/client/types";

const { field, failure } = COPY.shared;

type Context = FLRefusedField["ctx"];
type Path = FLRefusedField["path"];

/**
 * The latest birthdate that is `years` old today in Berlin: the same day that many years back, or the month's last day
 * where that year holds no such day, as a person born on 29 February turns a year older on 28 February.
 */
export function bornBy(years: number): CalendarDay {
  const [year, month, day] = dayIn(now()).split("-").map(Number) as [number, number, number];
  const lastOfMonth = new Date(Date.UTC(year - years, month, 0)).getUTCDate();
  // Midday UTC, the same calendar day in Berlin all year.
  return dayIn(new Date(Date.UTC(year - years, month - 1, Math.min(day, lastOfMonth), 12)));
}

/** The earliest birthdate at most `years` old today: the day after the latest that is a year older. */
export function bornAfter(years: number): CalendarDay {
  const [year, month, day] = bornBy(years + 1)
    .split("-")
    .map(Number) as [number, number, number];
  return dayIn(new Date(Date.UTC(year, month - 1, day + 1, 12)));
}

/**
 * An age the write refused, by its range in whole years: the latest birthdate the floor admits, the box's own latest
 * day, which the field's own check names first. A date past the ceiling the box's earliest day catches before the send.
 */
const ageRange = ({ min, max }: Context) => (typeof min === "number" && typeof max === "number" ? field.latest(bornBy(min)) : undefined);

/** A span's end: earliest its start, which the backend's rule names, as the end box's own earliest day reads. */
const notBeforeStart = ({ start }: Context) => (typeof start === "string" ? field.earliest(dayOf(start)) : undefined);

/** A figure held under the bound the server names, `max`: the most the box takes now. */
const atMost = ({ max }: Context) => (typeof max === "number" ? field.max(max) : undefined);

/** A figure held over the bound the server names, `min`: the least the box takes now. */
const atLeast = ({ min }: Context) => (typeof min === "number" ? field.min(min) : undefined);

/**
 * Each rule the backend refuses a payload with that a field pattern words, by its kind, from the bounds the rule's
 * context carries: the same line the box shows where the form's own check catches the value
 * (`fl_frontend/src/core/zodGerman.ts :: fieldMessage`). Beside them, each code whose phrase names a bound its refusal
 * carries, by the code, which every field the refusal names carries as its kind with the bounds as its context
 * (`fl_backend/app/core/exceptions.py :: APIError`); a code whose phrase names none stays `SERVER_COPY.refusal`'s.
 */
const PATTERNED = {
  // A season's id is its year, which takes no thousands separator.
  saison_year_out_of_range: ({ min, max }: Context) =>
    typeof min === "number" && typeof max === "number" ? field.between({ year: min }, { year: max }) : undefined,
  saison_ends_before_start: notBeforeStart,
  bewerbung_window_ends_before_start: notBeforeStart,
  spieltag_ends_before_start: notBeforeStart,
  good_spieler_exceed_kader: ({ max }: Context) => (typeof max === "number" ? field.max(max) : undefined),
  // The confirmation pages' birthdate, refused for an age outside the range the write names.
  confirmation_age: ageRange,
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
  // The registration closes before the season starts; `latest` is the day before its start.
  registrierung_window_reaches_saison_start: ({ latest }: Context) => (typeof latest === "string" ? field.latest(dayOf(latest)) : undefined),
  // A season's rules held to what the season already holds, each bound read by the server from the season as it stands.
  rules_qualifiers_above_gruppe: atMost,
  // Between the floor the write publishes for the box and the points a win is worth.
  rules_unentschieden_outvalues_win: ({ max }: Context) =>
    typeof max === "number" ? field.between(saisonsPatchSaisonBodyRulesDrawPointsMin, max) : undefined,
  rules_forfeit_unentschieden_in_a_knockout: atLeast,
  rules_gruppen_in_use: atLeast,
  rules_capacity_below_use: atLeast,
  rules_kader_below_use: atLeast,
  rules_qualifiers_below_wiring: atLeast,
  // One mapping for both dates, the span the dated matchdays need, named on each side that falls short: the start no
  // later than the first matchday's start, the end no earlier than the last one's end.
  saison_span_below_spieltage: ({ start, end }: Context, [side]: Path) =>
    side === "start_date" && typeof start === "string"
      ? field.latest(dayOf(start))
      : side === "end_date" && typeof end === "string"
        ? field.earliest(dayOf(end))
        : undefined,
  // An exit dated before the season's start, when the replacement is the route: the season's start is the earliest day.
  austritt_before_saison_start: ({ earliest }: Context) => (typeof earliest === "string" ? field.earliest(dayOf(earliest)) : undefined),
} satisfies Partial<Record<Rule | Code, (context: Context, path: Path) => Copy | undefined>>;

/**
 * Every rule a refused payload can name that the catalogue words, by a pattern or by `SERVER_COPY.ruleLine`'s sentence,
 * and every code a pattern words from its bounds.
 */
export type WordedRule = keyof typeof PATTERNED | keyof typeof SERVER_COPY.ruleLine;

const isPatterned = (kind: string): kind is keyof typeof PATTERNED => Object.hasOwn(PATTERNED, kind);
const isLined = (kind: string): kind is keyof typeof SERVER_COPY.ruleLine => Object.hasOwn(SERVER_COPY.ruleLine, kind);

/** Whether the catalogue words this rule, so a screen may place it. */
export const isWordedRule = (kind: string): kind is WordedRule => isPatterned(kind) || isLined(kind);

/** Whether a pattern words this code from the bounds its refusal carries, so `ruleMessage` words its fields. */
export const isBoundedCode = (code: Code): boolean => isPatterned(code);

/**
 * A rule the backend refused a payload with, or a code whose phrase names its bounds: under its field, in the same
 * fixed patterns a Zod issue's line takes, or, where no pattern words a rule, as its sentence on the status line. A
 * context missing the bound its pattern names means a page older than the API, so it answers the unexpected line on
 * the status line, as any rule the catalogue does not word does.
 */
export function ruleMessage({ kind, ctx, path }: Pick<FLRefusedField, "kind" | "ctx" | "path">): { field: Copy } | { line: Copy } {
  if (isPatterned(kind)) {
    const phrase = PATTERNED[kind](ctx, path);
    return phrase === undefined ? { line: failure.unexpected } : { field: phrase };
  }
  if (isLined(kind)) return { line: SERVER_COPY.ruleLine[kind] };
  return { line: failure.unexpected };
}
