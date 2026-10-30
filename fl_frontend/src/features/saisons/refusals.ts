import { SAISONS_EINTRAG } from "@/features/admin/constants";
import { isRefusal } from "@/shared/utils/actionError";

import {
  GRUPPEN_OFF_RULES,
  MAX_QUALIFIERS,
  RECORDED_FACTS_NONE,
  REGELN_ABSCHNITT,
  SPIELBERICHTE_HALTEN_DEN_SPIELPLAN,
  SPIELPLAN_ABSCHNITT,
  SPIELTAGE_UNDATED,
} from "./constants";

import type { FieldErrors } from "@/shared/utils/validation";

// The box offers another id; editing the season already holding this one is the way out it lacks.
const SAISON_ID_TAKEN = `Diese Saison-ID ist schon vergeben. Bearbeite die vorhandene Saison unter „${SAISONS_EINTRAG.label}“.`;

/**
 * The stored-rules faults a DRAW raises as well as an edit, each worded once: the rules editor
 * seats the sentence under its field, and the generator, having no field, seats it in a message that
 * names where the repair is made.
 */
const BRACKET_HAS_NO_SHAPE = `Die Zahl der Gruppen mal die Qualifikanten pro Gruppe muss eine Zweierpotenz von 2 bis ${String(MAX_QUALIFIERS)} ergeben.`;
const GROUP_OVER_QUALIFIES = "Eine Gruppe kann nicht mehr Teams qualifizieren, als sie fasst.";
const DRAW_BEATS_WIN = "Ein Unentschieden darf nicht mehr Punkte bringen als ein Sieg.";
const FORFEIT_CANNOT_DECIDE =
  "Sieger und Verlierer brauchen unterschiedliche Tore, denn in der KO-Runde bringt ein Unentschieden niemanden weiter.";
// No count and no ceiling: both follow from the shape, and a figure typed into German is a second
// bound nothing holds to the backend's own.
const TOO_MANY_FIXTURES =
  "Aus so vielen Gruppen und Teams pro Gruppe entstehen mehr Spiele, als eine Saison auf einmal fassen kann. Senke eine der beiden Zahlen.";

/**
 * The half `saison_span_below_spielplan` and the draw's `saison_span_below_spielplan_as_stored` share: the dates repair every state, because
 * `fl_backend/app/api/saisons/schedule.py :: group_matchdays` is flat from an even `teams_per_group`
 * down to the odd one and a smaller number does not always buy a day back.
 */
const SPAN_BELOW_SCHEDULE =
  "Der Zeitraum dieser Saison ist zu kurz für die Spieltage, die sich aus ihren Regeln ergeben. Verlege das Enddatum nach " +
  "hinten oder das Startdatum nach vorne. Das hilft in jedem Fall.";

/** A stored-rules fault as the generator must report it: the rule, then where it is repaired. */
const rulesFaultMessage = (fault: string): string => `${fault} Ändere die Zahlen im Abschnitt ${REGELN_ABSCHNITT} und speichere sie.`;

/**
 * The same fault where the DRAW carried the numbers itself. `rules_shape_after_spielplan` freezes them everywhere
 * else, so sending an admin to the rules panel would name a field they cannot type in.
 */
const shapeFaultMessage = (fault: string): string => `${fault} Ändere die Zahlen im Abschnitt ${SPIELPLAN_ABSCHNITT} und lege ihn erneut an.`;

/** A rules refusal as the message it should render, or `null` when the code is none of these. */
export function mapRulesRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "rules_bracket_impossible":
      return { fieldErrors: { "rules.qualifiers_per_group": BRACKET_HAS_NO_SHAPE } };
    case "rules_gruppen_in_use":
      return { fieldErrors: { "rules.number_of_groups": "Eine Gruppe, die noch Teams hält, kann nicht wegfallen." } };
    case "rules_capacity_below_use":
      return { fieldErrors: { "rules.teams_per_group": "Mindestens eine Gruppe hält schon mehr Teams als dieses Maximum." } };
    case "rules_qualifiers_below_wiring":
      return {
        fieldErrors: {
          "rules.qualifiers_per_group": "Ein Platz im KO-Baum verweist auf eine Platzierung, die dann nicht mehr erreicht wird.",
        },
      };
    case "rules_qualifiers_above_gruppe":
      return { fieldErrors: { "rules.qualifiers_per_group": GROUP_OVER_QUALIFIES } };
    // Only a step that introduces or worsens it is refused, and an equal count is allowed — so the
    // message says "mehr" rather than promising a rule the server does not apply.
    case "rules_unentschieden_outvalues_win":
      return { fieldErrors: { "rules.draw_points": DRAW_BEATS_WIN } };
    case "rules_kader_below_use":
      return { fieldErrors: { "rules.max_kadergroesse": "Mindestens ein Kader hat schon mehr Spieler als dieses Maximum." } };
    // On the winner's box, which is the one to raise, and only there: the pair's own row picks it up
    // through `saisonDraftStatus`'s `errorPaths`.
    case "rules_forfeit_unentschieden_in_a_knockout":
      return { fieldErrors: { "rules.forfeit_ergebnis.sieger_tore": FORFEIT_CANNOT_DECIDE } };
    // Neither freeze can see whether the other holds, so each names only the fields it freezes. A
    // reload is the whole repair: the panel holds these read-only, so only a season that started
    // under an open page reaches this, a finished one having started first.
    case "rules_saison_started":
      return {
        error: "Diese Saison hat begonnen, deshalb sind Punkte, Tiebreak und Qualifikanten pro Gruppe festgeschrieben. Lade die Seite neu.",
      };
    // A bare message, the shape `rules_saison_started` uses: the two freezes refuse the same class of edit
    // in one panel, and one answering through field paths would split that into two mechanisms.
    case "rules_shape_after_spielplan":
      return {
        // No window and no repair: `FormRegelnSection.tsx :: SHAPE_NOTE` states whichever of the
        // three cases holds, unconditionally and on the state the reloaded panel is in, where a
        // toast can only hand the reader the condition to evaluate.
        error:
          "Für diese Saison sind Spiele angesetzt, deshalb sind Gruppen, Teams pro Gruppe und Qualifikanten pro Gruppe gesperrt. " +
          `Lade die Seite neu. Im Abschnitt ${REGELN_ABSCHNITT} steht dann, was sich noch ändern lässt.`,
      };
    // Bare too, and for `saison_span_below_spielplan`'s reason rather than a freeze's: the two counts make the
    // fixture total together, so neither is the field at fault.
    case "rules_spiele_over_one_read":
      return { error: TOO_MANY_FIXTURES };
    case "rules_spieltag_over_its_phase":
      return {
        error: "Mindestens ein Spieltag enthält mehr Spiele, als diese Regeln vorsehen. Erhöhe die Zahlen wieder.",
      };
    case "saison_span_below_spieltage":
      return {
        error: "Mindestens ein Spieltag liegt außerhalb des neuen Zeitraums. Erweitere den Zeitraum wieder oder verschiebe diese Spieltage.",
      };
    // Bare like the two freezes: several fields could repair this and none is at fault. The tail is
    // this path's own: an edit reaches every rule, so the second repair names no single panel.
    case "saison_span_below_spielplan":
      return {
        error: `${SPAN_BELOW_SCHEDULE} Weniger Spieltage ergeben sich nur aus anderen Regeln, und die lassen sich nicht in jeder Saison noch ändern.`,
      };
    default:
      return null;
  }
}

/**
 * A generator refusal as the message it should render, or `null` for any other code. A state the panel
 * already closes the control for means the page went stale, so it says to reload; every other code
 * names a repair and where it is made.
 */
export function mapSpielplanRefusal(error: unknown, carriedShape: boolean): string | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // Both step aside for a confirmed replace, so either arriving means the season gained rows after
    // this page rendered: the request went out as a first draw because that is what the panel saw.
    case "spielplan_already_drawn":
      return "Für diese Saison sind inzwischen Spiele angelegt, und diese Anfrage hat kein Ersetzen bestätigt. Lade die Seite neu.";
    case "spielplan_spieltage_held":
      return "Für diese Saison gibt es inzwischen Spieltage, und diese Anfrage hat kein Ersetzen bestätigt. Lade die Seite neu.";
    // A LAUFENDE Saison still draws: activation is one-way, so refusing one would strand a season
    // activated before its draw. `activate_target_undrawn` is the half that keeps that state rare.
    case "saison_past":
      return "Diese Saison ist inzwischen abgeschlossen. Für eine abgeschlossene Saison entsteht kein Spielplan mehr. Lade die Seite neu.";
    // The endpoint names every off group in developer English. This says the class of repair
    // instead, and where it is made: group membership stands on the team pages. Short, over and
    // stranded share one repair.
    case "spielplan_gruppen_off_rules":
      return GRUPPEN_OFF_RULES;
    // The window closed under a confirmed replace, so the page is stale. A reload, like `spielplan_already_drawn`: the
    // panel it returns to names the half that closed and, for the record half, the way out of it.
    case "spielplan_replace_outside_its_window":
      return (
        `Ein Spielplan lässt sich nur für eine geplante Saison neu anlegen, zu deren Spielen noch nichts eingetragen ist: ${RECORDED_FACTS_NONE}. ` +
        "Diese Saison erfüllt das inzwischen nicht mehr. Lade die Seite neu."
      );
    case "spielplan_berichte_eingereicht":
      return SPIELBERICHTE_HALTEN_DEN_SPIELPLAN;
    // These three read the shape alone, whose numbers the Spielplan panel holds.
    case "rules_bracket_impossible":
      return shapeFaultMessage(`Aus diesen Zahlen entsteht keine KO-Runde. ${BRACKET_HAS_NO_SHAPE}`);
    case "rules_qualifiers_above_gruppe":
      return shapeFaultMessage(GROUP_OVER_QUALIFIES);
    case "rules_spiele_over_one_read":
      return shapeFaultMessage(TOO_MANY_FIXTURES);
    // The forfeit is never a draw's own number, so its repair is the rules panel.
    case "rules_forfeit_unentschieden_in_a_knockout_as_stored":
      return rulesFaultMessage(FORFEIT_CANNOT_DECIDE);
    // NOT through a fault message, whose tails send the admin to change a number: the dates are the
    // repair that works whatever the numbers are. Only where a smaller one could be typed differs,
    // which the ternary carries.
    case "saison_span_below_spielplan_as_stored":
      return (
        `${SPAN_BELOW_SCHEDULE} Weniger Spieltage ergeben sich sonst nur aus kleineren Zahlen im Abschnitt ` +
        `${carriedShape ? SPIELPLAN_ABSCHNITT : REGELN_ABSCHNITT}, und nicht jede kleinere Zahl spart einen Spieltag.`
      );
    default:
      return null;
  }
}

/** `null` for any code but the unique index's, which on a season can be about its `_id` alone. */
export function mapSaisonIdRefusal(error: unknown): { error: string; fieldErrors: FieldErrors } | null {
  if (!isRefusal(error) || error.serverErrorCode !== "duplicate_key") return null;

  return { error: SAISON_ID_TAKEN, fieldErrors: { id: SAISON_ID_TAKEN } };
}

/**
 * The activation's four refusals, or `null`. The panel closes the control for all four, so any of them
 * arriving means the page is stale. Three name a remedy; `saison_past` has none, and says so rather
 * than implying one.
 */
export function mapActivateRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "activate_saison_unfinished":
      return "Die laufende Saison hat noch Spiele ohne Ergebnis. Trage die Ergebnisse ein oder sage die Spiele ab.";
    case "saison_past":
      return "Diese Saison ist inzwischen abgeschlossen und wird nicht wieder zur laufenden Saison. Lade die Seite neu.";
    case "activate_target_undrawn":
      return "Diese Saison hat noch keinen Spielplan, und ohne Spiele wird sie nicht zur laufenden Saison. Lege den Spielplan an und stelle danach um.";
    // The declaration rather than a copy of its words: the closed press reads the same constant, so
    // the toast and the button cannot say different things about one rule.
    case "activate_spieltage_undated":
      return SPIELTAGE_UNDATED;
    default:
      return null;
  }
}

/**
 * The group swap's refusals, or `null`. The first four mean the picture moved under a stale page, so
 * each says to reload; `swap_fields_disqualified` has no client counterpart and arrives on a current page, so it
 * names a repair.
 */
export function mapSwapRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // One club named on both sides is among them, which the picker offers only on a page gone stale: the
    // same sentence and the same reload serve it.
    case "swap_not_a_swap":
      return "Die beiden Teams stehen nicht mehr in zwei verschiedenen Gruppen dieser Saison. Lade die Seite neu.";
    case "saison_past":
      return "Diese Saison ist inzwischen abgeschlossen. Lade die Seite neu.";
    case "swap_saison_started":
      return "Diese Saison hat inzwischen begonnen. Lade die Seite neu.";
    case "swap_spieltag_clash":
      return "Durch den Tausch stünde ein Team zweimal an einem Spieltag. Verschiebe eines der beiden Spiele und lade die Seite neu.";
    // Lifting the record is an open path, so the sentence names all three steps.
    case "swap_fields_disqualified":
      return "Durch den Tausch käme ein ausgeschiedenes Team auf Spiele, die nach seinem Austritt stattfinden können. Hebe den Austritt auf, tausche die Gruppen und trage ihn danach erneut ein.";
    default:
      return null;
  }
}

/**
 * `null` for another refusal. The panel closes the control for both halves of `spielplan_undraw_outside_its_window`, so it arriving means the season
 * moved under a page still offering the press; a reload returns to that panel, which names any way out.
 */
export function mapUndrawRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;
  if (error.serverErrorCode === "spielplan_berichte_eingereicht") return SPIELBERICHTE_HALTEN_DEN_SPIELPLAN;
  if (error.serverErrorCode !== "spielplan_undraw_outside_its_window") return null;

  return (
    `Ein Spielplan lässt sich nur für eine geplante Saison zurücknehmen, zu deren Spielen noch nichts eingetragen ist: ${RECORDED_FACTS_NONE}. ` +
    "Diese Saison erfüllt das inzwischen nicht mehr. Lade die Seite neu."
  );
}
