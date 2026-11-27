import { now } from "./clock";
import { ADMIN_COPY } from "./copy/admin";
import { COPY } from "./copy/shared";
import { bornBy } from "./dayArithmetic";
import { dayIn, dayOf } from "./format";
import { saisonsPatchSaisonBodyRulesDrawPointsMin, saisonsPatchSaisonBodyRulesLossPointsMin } from "./generated/zod/inputs";
import { ownKeyOf } from "./ownKeyOf";
import { SERVER_COPY } from "./serverCopy";

import type { Copy } from "./copy";
import type { FieldCode, FLRefusedField, Rule } from "./generated/client/types";

const { field } = COPY.shared;

type Context = FLRefusedField["ctx"];
type Path = FLRefusedField["path"];

/** One fault as the catalogue words it: its kind, the bounds it carries, and the path naming its field. */
type Fault = Pick<FLRefusedField, "kind" | "ctx" | "path">;

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

const taken = () => field.taken;
const barred = () => field.barred;
const ofAdministration = () => field.ofAdministration;
const onFile = () => field.onFile;
const required = () => field.required;

/** A field phrase by the bounds its fault carries and the path naming its field: `undefined` where a bound is missing. */
type Pattern = (context: Context, path: Path) => Copy | undefined;

/**
 * Each fault a field pattern words, by its kind, from the bounds the fault carries: every code the backend raises on a
 * box (`FieldCode`), so a code published without a phrase fails the type check, and each rule a refused payload names
 * that a pattern words, the same line the box shows where the form's own check catches the value. A phrase reused from
 * a state the catalogue already words keeps that entry, so one word stands for one state. A kind no pattern words, and
 * a fault on a field the screen shows no box for, take their sentence (`sentenceOf`).
 */
const PATTERNED = {
  // „Schon vergeben“: a unique index, and the rules of their own beside one, a seat of an application or a season row
  // and a squad's one Kapitän per team among them.
  duplicate_key: taken,
  kontakt_email_taken: taken,
  kontakt_phone_taken: taken,
  bewerbung_kontakt_repeated: taken,
  trikot_farbe_taken: taken,
  kader_rolle_taken: taken,
  spiel_double_booked: taken,
  address_change_taken: taken,
  address_barred: barred,
  grant_barred: barred,
  admin_address: ofAdministration,
  ban_list_admin: ofAdministration,
  grant_exists: ofAdministration,
  own_address: () => field.onlyInKonto,
  address_change_unchanged: onFile,
  ansetzung_vorschlag_unchanged: onFile,
  booking_unknown_resource: () => COPY.shared.retired,
  booking_unconfirmed_schiedsrichter: () => COPY.shared.state.unconfirmed,
  // The acceptance's shorthand left empty for a new school, and an application naming no school.
  payload_refused: required,
  bewerbung_submission_subject_unresolved: required,
  // A pupil a report or a line-up names who left the squad since, as the line-up's row marks one.
  spieler_not_in_kader: () => COPY.kader.deregistered,
  // The administration's own phrases for a club out of the season and a no-show picked before both sides are known.
  eligibility_disqualified: () => ADMIN_COPY.spiel.departed,
  state_nichtantreten_without_two_sides: () => ADMIN_COPY.bothTeamsLocked,
  // One rule over two codes: a match whose result no play decides carries no goals, on the fixture and in its report.
  state_ergebnis_on_a_non_event: () => field.without(COPY.shared.tore),
  // A media consent given below its floor, the phrase its switch shows while closed.
  media_age: ({ min }) => (typeof min === "number" ? COPY.shared.mediaFrom(min) : undefined),
  aufstellung_nominee_without_shortage: atMost,
  // A season's rules held to what the season already holds, each bound read by the server from the season as it stands.
  rules_qualifiers_above_gruppe: atMost,
  // Between the floor the write publishes for the box and the points a win is worth.
  rules_unentschieden_outvalues_win: ({ max }) =>
    typeof max === "number" ? field.between(saisonsPatchSaisonBodyRulesDrawPointsMin, max) : undefined,
  // Between the floor the write publishes for the box and the points a draw is worth.
  rules_niederlage_outvalues_unentschieden: ({ max }) =>
    typeof max === "number" ? field.between(saisonsPatchSaisonBodyRulesLossPointsMin, max) : undefined,
  rules_forfeit_unentschieden_in_a_knockout: atLeast,
  rules_gruppen_in_use: atLeast,
  rules_capacity_below_use: atLeast,
  rules_kader_below_use: atLeast,
  // A season too short for the matchdays its rules draw, on its end: `earliest` is the first end that holds them all.
  saison_span_below_spielplan: notBefore,
  // An exit dated before the season's start, when the replacement is the route: the season's start is the earliest day.
  austritt_before_saison_start: notBefore,
  // A proposed day gone by: `earliest` is today.
  ansetzung_vorschlag_past: notBefore,
  // A start moved later than a stored exit allows, an exit recorded since the start the season had: `latest` is that start.
  saison_start_austritt_stored: notAfter,
  // The confirmation pages' birthdate, refused for an age outside the range the write names.
  confirmation_age: ageRange,
  // A fixture's date outside its matchday, by the side of the span it falls past.
  spiel_outside_spieltag: (context) => notBefore(context) ?? notAfter(context),
  // One mapping for both dates, the span the dated matchdays need, named on each side that falls short: the start no
  // later than the first matchday's start, the end no earlier than the last one's end.
  saison_span_below_spieltage: ({ start, end }, [side]) =>
    side === "start_date" && typeof start === "string"
      ? field.latest(dayOf(start))
      : side === "end_date" && typeof end === "string"
        ? field.earliest(dayOf(end))
        : undefined,
  // A matchday's day outside its season, short of the fixtures it holds, or out of the matchdays' order, by the side of
  // the bound it falls past; and a season's start moved once a match of it has taken place, by the stored start.
  spieltag_outside_saison: (context) => notBefore(context) ?? notAfter(context),
  spieltag_span_below_spiele: (context) => notBefore(context) ?? notAfter(context),
  spieltag_start_out_of_order: (context) => notBefore(context) ?? notAfter(context),
  saison_start_taken_place: (context) => notBefore(context) ?? notAfter(context),
  // A Stufe the season stopped offering since the page offered it.
  kader_stufe_not_allowed: () => field.notAllowed,
  saison_ends_before_start: notBeforeStart,
  bewerbung_window_ends_before_start: notBeforeStart,
  spieltag_ends_before_start: notBeforeStart,
  good_spieler_exceed_kader: atMost,
  // A box left empty that the rule requires once another box is set.
  decline_without_reason: required,
  email_not_accepted: () => field.format(field.exampleAddress),
  url_not_accepted: () => field.format(field.exampleUrl),
  // A no-show's report carries no play: the league composes its goals, and nobody scored them.
  nichtantreten_with_scorers: () => field.without(COPY.spielplan.scorers),
  // The registration closes before the season starts; `latest` is the day before its start.
  registrierung_window_reaches_saison_start: notAfter,
} satisfies Record<FieldCode, Pattern> & Partial<Record<Rule, Pattern>>;

/**
 * A fault's phrase for the box its field stands for, in the fixed patterns a Zod issue's line takes. `undefined` where
 * no pattern words its kind, or where its bounds lack one its pattern names, a page older than the API.
 */
export function phraseOf({ kind, ctx, path }: Fault): Copy | undefined {
  return ownKeyOf(PATTERNED, kind) ? PATTERNED[kind](ctx, path) : undefined;
}

/** A sentence filled from the bounds its fault carries, as a pattern fills a phrase: `undefined` where one is missing. */
type BoundedSentence = (context: Context) => Copy | undefined;

type LineEntry = Copy | Readonly<Record<string, Copy>> | BoundedSentence;

/** An entry's sentence for one fault: its one sentence, the one its bounds fill, or the one keyed by its path's first name. */
function sentenceIn(entry: LineEntry, { ctx, path }: Pick<Fault, "ctx" | "path">): Copy | undefined {
  if (typeof entry === "string") return entry;
  if (typeof entry === "function") return entry(ctx);
  const [head] = path;
  return typeof head === "string" && Object.hasOwn(entry, head) ? entry[head] : undefined;
}

/**
 * A fault's sentence for the status line, by its kind: a code's (`SERVER_COPY.refusalLine`), keyed by its path's first
 * name where one code is about several fields, or a rule's (`SERVER_COPY.ruleLine`). `undefined` where the catalogue
 * holds none for it, which reads as every refusal the catalogue does not word.
 */
export function sentenceOf(fault: Pick<Fault, "kind" | "ctx" | "path">): Copy | undefined {
  const { kind } = fault;
  if (ownKeyOf(SERVER_COPY.refusalLine, kind)) return sentenceIn(SERVER_COPY.refusalLine[kind], fault);
  if (ownKeyOf(SERVER_COPY.ruleLine, kind)) return SERVER_COPY.ruleLine[kind];
  return undefined;
}
