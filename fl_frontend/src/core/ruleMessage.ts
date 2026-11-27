import { now } from "./clock";
import { COPY } from "./copy/shared";
import { bornBy } from "./dayArithmetic";
import { dayIn, dayOf } from "./format";
import { saisonsPatchSaisonBodyRulesDrawPointsMin, saisonsPatchSaisonBodyRulesLossPointsMin } from "./generated/zod/inputs";
import { ownKeyOf } from "./ownKeyOf";
import { SERVER_COPY } from "./serverCopy";

import type { Copy } from "./copy";
import type { Code, FLRefusedField, Rule } from "./generated/client/types";

const { field, failure } = COPY.shared;

type Context = FLRefusedField["ctx"];
type Path = FLRefusedField["path"];

/**
 * An age the write refused, by its range in whole years: the latest birthdate the floor admits on Berlin's day, the
 * box's own latest day, which the field's own check names first. A date past the ceiling the box's earliest day catches
 * before the send.
 */
const ageRange = ({ min }: Context) => (typeof min === "number" ? field.latest(bornBy(dayIn(now()), min)) : undefined);

/** A span's end: earliest its start, which the backend's rule names, as the end box's own earliest day reads. */
const notBeforeStart = ({ start }: Context) => (typeof start === "string" ? field.earliest(dayOf(start)) : undefined);

/** A figure held under the bound the server names, `max`: the most the box takes now. */
const atMost = ({ max }: Context) => (typeof max === "number" ? field.max(max) : undefined);

/** A figure held over the bound the server names, `min`: the least the box takes now. */
const atLeast = ({ min }: Context) => (typeof min === "number" ? field.min(min) : undefined);

/** A day held to the last day the server names, `latest`: the latest day the box takes now. */
const notAfter = ({ latest }: Context) => (typeof latest === "string" ? field.latest(dayOf(latest)) : undefined);

/** A day held to the first day the server names, `earliest`: the earliest day the box takes now. */
const notBefore = ({ earliest }: Context) => (typeof earliest === "string" ? field.earliest(dayOf(earliest)) : undefined);

/**
 * Each rule the backend refuses a payload with that a field pattern words, by its kind, from the bounds the rule's
 * context carries: the same line the box shows where the form's own check catches the value. Beside them, each code a
 * field pattern words, by the code, which every field the refusal names carries as its kind, with the bounds as its
 * context where the phrase names one. A code no pattern words takes `SERVER_COPY.refusalLine`'s sentence.
 */
const PATTERNED = {
  duplicate_key: () => field.taken,
  // One rule over two codes: a match whose result no play decides carries no goals, on the fixture and in its report.
  state_ergebnis_on_a_non_event: () => field.without(COPY.shared.tore),
  // A rule of their own rather than a unique index: a seat of an application or a season row, and a squad's one Kapitän per team.
  bewerbung_kontakt_repeated: () => field.taken,
  trikot_farbe_taken: () => field.taken,
  kontakt_email_taken: () => field.taken,
  kontakt_phone_taken: () => field.taken,
  kader_rolle_taken: () => field.taken,
  saison_ends_before_start: notBeforeStart,
  bewerbung_window_ends_before_start: notBeforeStart,
  spieltag_ends_before_start: notBeforeStart,
  good_spieler_exceed_kader: atMost,
  // The confirmation pages' birthdate, refused for an age outside the range the write names.
  confirmation_age: ageRange,
  // A box left empty that the rule requires once another box is set.
  decline_without_reason: () => field.required,
  email_not_accepted: () => field.format(field.exampleAddress),
  url_not_accepted: () => field.format(field.exampleUrl),
  // A no-show's report carries no play: the league composes its goals, and nobody scored them.
  nichtantreten_with_scorers: () => field.without(COPY.spielplan.scorers),
  // The registration closes before the season starts; `latest` is the day before its start.
  registrierung_window_reaches_saison_start: notAfter,
  // A season's rules held to what the season already holds, each bound read by the server from the season as it stands.
  rules_qualifiers_above_gruppe: atMost,
  // Between the floor the write publishes for the box and the points a win is worth.
  rules_unentschieden_outvalues_win: ({ max }: Context) =>
    typeof max === "number" ? field.between(saisonsPatchSaisonBodyRulesDrawPointsMin, max) : undefined,
  // Between the floor the write publishes for the box and the points a draw is worth.
  rules_niederlage_outvalues_unentschieden: ({ max }: Context) =>
    typeof max === "number" ? field.between(saisonsPatchSaisonBodyRulesLossPointsMin, max) : undefined,
  rules_forfeit_unentschieden_in_a_knockout: atLeast,
  rules_gruppen_in_use: atLeast,
  rules_capacity_below_use: atLeast,
  rules_kader_below_use: atLeast,
  // One mapping for both dates, the span the dated matchdays need, named on each side that falls short: the start no
  // later than the first matchday's start, the end no earlier than the last one's end.
  saison_span_below_spieltage: ({ start, end }: Context, [side]: Path) =>
    side === "start_date" && typeof start === "string"
      ? field.latest(dayOf(start))
      : side === "end_date" && typeof end === "string"
        ? field.earliest(dayOf(end))
        : undefined,
  // A season too short for the matchdays its rules draw, on its end: `earliest` is the first end that holds them all.
  saison_span_below_spielplan: notBefore,
  // A start moved later than a stored exit allows, an exit recorded since the start the season had: `latest` is that start.
  saison_start_austritt_stored: notAfter,
  // An exit dated before the season's start, when the replacement is the route: the season's start is the earliest day.
  austritt_before_saison_start: notBefore,
} satisfies Partial<Record<Rule | Code, (context: Context, path: Path) => Copy | undefined>>;

/**
 * Every rule a refused payload can name that the catalogue words, by a pattern or by `SERVER_COPY.ruleLine`'s sentence,
 * and every code a pattern words.
 */
export type WordedRule = keyof typeof PATTERNED | keyof typeof SERVER_COPY.ruleLine;

const isPatterned = (kind: string) => ownKeyOf(PATTERNED, kind);
const isLined = (kind: string) => ownKeyOf(SERVER_COPY.ruleLine, kind);

/** Whether the catalogue words this rule, so a screen may place it. */
export const isWordedRule = (kind: string) => isPatterned(kind) || isLined(kind);

/** Whether a field pattern words this code, so `ruleMessage` words each field its refusal names. */
export const isPatternedCode = (code: Code): boolean => isPatterned(code);

/**
 * A rule the backend refused a payload with, or a code a field pattern words: under its field, in the same
 * fixed patterns a Zod issue's line takes, or, where no pattern words a rule, as its sentence on the status line. A
 * context missing the bound its pattern names means a page older than the API, so it answers the stale line on the
 * status line, as every refusal the catalogue does not word does; a rule the catalogue does not word never reaches it.
 */
export function ruleMessage({ kind, ctx, path }: Pick<FLRefusedField, "kind" | "ctx" | "path">): { field: Copy } | { line: Copy } {
  if (isPatterned(kind)) {
    const phrase = PATTERNED[kind](ctx, path);
    return phrase === undefined ? { line: failure.stale } : { field: phrase };
  }
  if (isLined(kind)) return { line: SERVER_COPY.ruleLine[kind] };
  return { line: failure.stale };
}
