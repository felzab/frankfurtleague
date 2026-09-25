import { isRefusal } from "@/shared/utils/actionError";

import { GRUPPEN_OFF_RULES, RECORDED_FACTS_NONE, SPIELTAGE_UNDATED } from "./constants";
import { MAX_QUALIFIERS } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";

const SAISON_ID_TAKEN = "Diese Saison-ID ist schon vergeben. Wähle eine andere oder bearbeite die vorhandene Saison.";

/**
 * The stored-rules faults a DRAW raises as well as an edit, each worded once: the rules editor
 * seats the sentence under its field, and the generator, having no field, seats it in a message that
 * names where the repair is made.
 */
const BRACKET_HAS_NO_SHAPE = `Die Zahl der Gruppen mal die Qualifikanten pro Gruppe muss eine Zweierpotenz von 2 bis ${String(MAX_QUALIFIERS)} ergeben.`;
const GROUP_OVER_QUALIFIES = "Eine Gruppe kann nicht mehr Teams qualifizieren, als sie fasst.";
const DRAW_BEATS_WIN = "Ein Unentschieden darf nicht mehr Punkte bringen als ein Sieg.";
const FORFEIT_CANNOT_DECIDE =
  "Diese Saison spielt eine KO-Runde, in der ein Unentschieden niemanden weiterbringt. Sieger und Verlierer brauchen unterschiedliche Tore.";
// No count and no ceiling: both follow from the shape, and a figure typed into German is a second
// bound nothing holds to the backend's own.
const TOO_MANY_FIXTURES =
  "Aus so vielen Gruppen und Teams pro Gruppe entstehen mehr Spiele, als eine Saison auf einmal fassen kann. Senke eine der beiden Zahlen.";

/**
 * `REQ-DATE-005`'s shared half: the dates repair every state, because
 * `fl_backend/app/api/saisons/schedule.py :: group_matchdays` is flat from an even `teams_per_group`
 * down to the odd one and a smaller number does not always buy a day back.
 */
const SPAN_BELOW_SCHEDULE =
  "Der Zeitraum dieser Saison ist zu kurz für die Spieltage, die sich aus ihren Regeln ergeben. Verlege das Enddatum nach " +
  "hinten oder das Startdatum nach vorne; das hilft in jedem Fall.";

/** A stored-rules fault as the generator must report it: the rule, then where it is repaired. */
const rulesFaultMessage = (fault: string): string => `${fault} Ändere die Zahlen im Abschnitt Regeln und speichere sie.`;

/**
 * The same fault where the DRAW carried the numbers itself. `REQ-RULES-011` freezes them everywhere
 * else, so sending an admin to the rules panel would name a field they cannot type in.
 */
const shapeFaultMessage = (fault: string): string => `${fault} Ändere die Zahlen im Abschnitt Spielplan und lege ihn noch einmal neu an.`;

/** A rules refusal as the message it should render, or `null` when the code is none of these. */
export function mapRulesRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-RULES-001":
      return { fieldErrors: { "rules.qualifiers_per_group": BRACKET_HAS_NO_SHAPE } };
    case "REQ-RULES-002":
      return { fieldErrors: { "rules.number_of_groups": "Eine Gruppe, die noch Teams hält, kann nicht wegfallen." } };
    case "REQ-RULES-003":
      return { fieldErrors: { "rules.teams_per_group": "Mindestens eine Gruppe hält schon mehr Teams als dieses Maximum." } };
    case "REQ-RULES-004":
      return {
        fieldErrors: {
          "rules.qualifiers_per_group": "Ein Platz im KO-Baum verweist auf eine Platzierung, die dann nicht mehr erreicht wird.",
        },
      };
    case "REQ-RULES-007":
      return { fieldErrors: { "rules.qualifiers_per_group": GROUP_OVER_QUALIFIES } };
    // Only a step that introduces or worsens it is refused, and an equal count is allowed — so the
    // message says "mehr" rather than promising a rule the server does not apply.
    case "REQ-RULES-008":
      return { fieldErrors: { "rules.draw_points": DRAW_BEATS_WIN } };
    case "REQ-RULES-009":
      return { fieldErrors: { "rules.max_kadergroesse": "Mindestens ein Kader hat schon mehr Spieler als dieses Maximum." } };
    // On the winner's box, which is the one to raise, and only there: the pair's own row picks it up
    // through `saisonDraftStatus`'s `errorPaths`.
    case "REQ-RULES-010":
      return { fieldErrors: { "rules.forfeit_ergebnis.sieger_tore": FORFEIT_CANNOT_DECIDE } };
    // Neither freeze can see whether the other holds, so each names only the fields it freezes. A
    // reload is the whole repair: the panel holds these three read-only, so only a season that
    // turned `past` under an open page reaches this.
    case "REQ-RULES-005":
      return {
        error:
          "Diese Saison ist abgeschlossen, deshalb sind Punkte, Tiebreak und Qualifikanten pro Gruppe festgeschrieben. Lade die Seite neu.",
      };
    // Bare like the freeze above, and a reload for the same reason: the panel holds the Tiebreak
    // closed once a KO fixture has been played, so only a result entered under an open page gets here.
    case "REQ-RULES-012":
      return {
        error: "Die KO-Runde dieser Saison hat begonnen, deshalb ist der Tiebreak festgeschrieben. Lade die Seite neu.",
      };
    // A bare message, the shape `REQ-RULES-005` uses: the two freezes refuse the same class of edit
    // in one panel, and one answering through field paths would split that into two mechanisms.
    case "REQ-RULES-011":
      return {
        // No window and no repair: `FormRegelnSection.tsx :: SHAPE_NOTE` states whichever of the
        // three cases holds, unconditionally and on the state the reloaded panel is in, where a
        // toast can only hand the reader the condition to evaluate.
        error:
          "Für diese Saison sind Spiele angesetzt, deshalb sind Gruppen, Teams pro Gruppe und Qualifikanten pro Gruppe gesperrt. " +
          "Lade die Seite neu; im Abschnitt Regeln steht dann, was sich noch ändern lässt.",
      };
    // Bare too, and for `REQ-DATE-005`'s reason rather than a freeze's: the two counts make the
    // fixture total together, so neither is the field at fault.
    case "REQ-RULES-013":
      return { error: TOO_MANY_FIXTURES };
    case "REQ-RULES-006":
      return {
        error: "Mindestens ein Spieltag enthält mehr Spiele, als diese Regeln vorsehen. Erhöhe die Zahlen wieder.",
      };
    case "REQ-DATE-004":
      return {
        error: "Mindestens ein Spieltag liegt außerhalb des neuen Zeitraums. Erweitere den Zeitraum wieder oder verschiebe diese Spieltage.",
      };
    // Bare like the two freezes: several fields could repair this and none is at fault. The tail is
    // this path's own: an edit reaches every rule, so the second repair names no single panel.
    case "REQ-DATE-005":
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

  // Which panel holds the three numbers this draw was judged on, and therefore where the repair is.
  const shapeFault = carriedShape ? shapeFaultMessage : rulesFaultMessage;

  switch (error.serverErrorCode) {
    // Both step aside for a confirmed replace, so either arriving means the season gained rows after
    // this page rendered: the request went out as a first draw because that is what the panel saw.
    case "REQ-SPIELPLAN-001":
      return "Für diese Saison sind inzwischen Spiele angelegt, und diese Anfrage hat kein Ersetzen bestätigt. Lade die Seite neu.";
    case "REQ-SPIELPLAN-002":
      return "Für diese Saison gibt es inzwischen Spieltage, und diese Anfrage hat kein Ersetzen bestätigt. Lade die Seite neu.";
    // A LAUFENDE Saison still draws: activation is one-way, so refusing one would strand a season
    // activated before its draw. `REQ-ACTIVATE-003` is the half that keeps that state rare.
    case "REQ-SPIELPLAN-003":
      return "Diese Saison ist inzwischen abgeschlossen. Für eine abgeschlossene Saison entsteht kein Spielplan mehr. Lade die Seite neu.";
    // The endpoint names every off group in developer English. This says the class of repair
    // instead, and where it is made: group membership stands on the team pages. Short, over and
    // stranded share one repair.
    case "REQ-SPIELPLAN-004":
      return GRUPPEN_OFF_RULES;
    // The window closed under a confirmed replace, so the page is stale. A reload, like `-001`: the
    // panel it returns to names the half that closed and, for the record half, the way out of it.
    case "REQ-SPIELPLAN-005":
      return (
        `Ein Spielplan lässt sich nur für eine geplante Saison neu anlegen, zu deren Spielen noch nichts eingetragen ist: ${RECORDED_FACTS_NONE}. ` +
        "Diese Saison erfüllt das inzwischen nicht mehr. Lade die Seite neu."
      );
    // The draw judges its own three numbers and the season's stored rest, so the first two are
    // repaired wherever this request took them from and the last two only in the rules panel.
    // `stored=None` there, so no narrowing rule answers.
    case "REQ-RULES-001":
      return shapeFault(
        `${carriedShape ? "Aus diesen Zahlen" : "Aus den Regeln dieser Saison"} entsteht keine KO-Runde. ${BRACKET_HAS_NO_SHAPE}`,
      );
    case "REQ-RULES-007":
      return shapeFault(GROUP_OVER_QUALIFIES);
    case "REQ-RULES-008":
      return rulesFaultMessage(DRAW_BEATS_WIN);
    case "REQ-RULES-010":
      return rulesFaultMessage(FORFEIT_CANNOT_DECIDE);
    // Through `shapeFault` rather than `rulesFaultMessage`: a replace carries the two counts this
    // total is computed from, so on that path the panel holding them is the Spielplan's.
    case "REQ-RULES-013":
      return shapeFault(TOO_MANY_FIXTURES);
    // NOT through `shapeFault`, whose two tails both send the admin to change a number: the repair
    // that works whatever the numbers are is the season's dates. Only where a smaller one could be
    // typed differs, which is what the ternary carries.
    case "REQ-DATE-005":
      return (
        `${SPAN_BELOW_SCHEDULE} Weniger Spieltage ergeben sich sonst nur aus kleineren Zahlen im Abschnitt ` +
        `${carriedShape ? "Spielplan" : "Regeln"}, und nicht jede kleinere Zahl spart einen Spieltag.`
      );
    default:
      return null;
  }
}

/** `null` for any code but the unique index's, which on a season can be about its `_id` alone. */
export function mapSaisonIdRefusal(error: unknown): { error: string; fieldErrors: FieldErrors } | null {
  if (!isRefusal(error) || error.serverErrorCode !== "DB-COMMON-002") return null;

  return { error: SAISON_ID_TAKEN, fieldErrors: { id: SAISON_ID_TAKEN } };
}

/**
 * The activation's four refusals, or `null`. The panel closes the control for all four, so any of them
 * arriving means the page is stale. Three name a remedy; `REQ-ACTIVATE-002` has none, and says so rather
 * than implying one.
 */
export function mapActivateRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-ACTIVATE-001":
      return "Die laufende Saison hat noch Spiele ohne Ergebnis. Trage die Ergebnisse ein oder sage die Spiele ab.";
    case "REQ-ACTIVATE-002":
      return "Diese Saison ist inzwischen abgeschlossen und wird nicht wieder zur laufenden Saison. Lade die Seite neu.";
    case "REQ-ACTIVATE-003":
      return "Diese Saison hat noch keinen Spielplan, und ohne Spiele wird sie nicht zur laufenden Saison. Lege den Spielplan an und stelle danach um.";
    // The declaration rather than a copy of its words: the closed press reads the same constant, so
    // the toast and the button cannot say different things about one rule.
    case "REQ-ACTIVATE-004":
      return SPIELTAGE_UNDATED;
    default:
      return null;
  }
}

/**
 * The group swap's refusals, or `null`. The first five mean the picture moved under a stale page, so
 * each says to reload; `REQ-SWAP-006` has no client counterpart and arrives on a current page, so it
 * names a repair.
 */
export function mapSwapRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "REQ-SWAP-001":
      return "Die beiden Teams stehen nicht mehr in zwei verschiedenen Gruppen dieser Saison. Lade die Seite neu.";
    case "REQ-SWAP-003":
      return "Diese Saison ist inzwischen abgeschlossen. Lade die Seite neu.";
    case "REQ-SWAP-002":
      return "In der KO-Runde dieser Saison wurde inzwischen gespielt. Lade die Seite neu.";
    case "REQ-SWAP-004":
      return "Mindestens eines der beiden Teams hat in seiner Gruppe inzwischen gespielt. Lade die Seite neu.";
    case "REQ-SWAP-005":
      return "Durch den Tausch stünde ein Team zweimal an einem Spieltag. Verschiebe eines der beiden Spiele und lade die Seite neu.";
    // Lifting the record is an open path, so the sentence names all three steps.
    case "REQ-SWAP-006":
      return "Durch den Tausch käme ein ausgeschiedenes Team auf Spiele, die nach seinem Austritt stattfinden können. Hebe den Austritt auf, tausche die Gruppen und trage ihn danach erneut ein.";
    default:
      return null;
  }
}

/**
 * `null` where the refusal is something else. The panel closes the control for both halves, so this
 * arriving means the season moved under a page still offering the press. A reload returns to that
 * panel, which names any way out.
 */
export function mapUndrawRefusal(error: unknown): string | null {
  if (!isRefusal(error) || error.serverErrorCode !== "REQ-SPIELPLAN-006") return null;

  return (
    `Ein Spielplan lässt sich nur für eine geplante Saison zurücknehmen, zu deren Spielen noch nichts eingetragen ist: ${RECORDED_FACTS_NONE}. ` +
    "Diese Saison erfüllt das inzwischen nicht mehr. Lade die Seite neu."
  );
}
