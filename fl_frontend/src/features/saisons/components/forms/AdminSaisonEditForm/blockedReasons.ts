import { GRUPPEN_OFF_RULES, RECORDED_FACTS_ANY, SPIELTAGE_UNDATED } from "@/features/saisons/constants";
import { drawGruppenRefusal, drawnSpieltage, drawShapeRefusal, fitsAnOfferedShape } from "@/features/saisons/shapeOffer";

import type { FLSaisonStatus, FLSpielplanShape } from "@/features/saisons/schemas";
import type { SaisonGruppenOccupancy } from "@/features/saisons/types";

/** Everything the draw control and the undraw beside it are decided from, read from one page render. */
export type SpielplanControlInput = {
  saisonStatus: FLSaisonStatus;
  /** Whether the season carries the generator's watermark. */
  hasSpielplan: boolean;
  /** `REQ-SPIELPLAN-001`: the season already holds fixtures, whoever put them there. */
  hasDrawnSpiele: boolean;
  /** `REQ-SPIELPLAN-002`'s condition: how many matchday rows the season holds, retired ones included. */
  spieltageCount: number;
  /** `REQ-SPIELPLAN-005`'s condition: how many fixtures carry something entered against them. */
  erfassteSpieleCount: number;
  /** Whether the season's served schedule reaches a knockout round at all, which a FIRST draw is judged on. */
  hasKoRunden: boolean;
  /** The season's STORED span, `REQ-DATE-009`'s offered side — what the draw would run on. */
  startDate: string;
  endDate: string;
  /** `REQ-DATE-009`'s required side for a FIRST draw: the matchdays the SERVED schedule implies, `buildSpielplanVorschau`'s sum. */
  vorschauSpieltage: number;
  /** `REQ-SPIELPLAN-004`'s condition over the season's STORED two numbers, which a first draw runs from. */
  gruppen: Parameters<typeof drawGruppenRefusal>[0];
};

// One day of UTC milliseconds. Date-only strings parse as UTC midnights, so dividing by it is exact.
const MS_PER_DAY = 86_400_000;

/**
 * One spelling for both closures: the repair is the season's own dates whichever of them closed the
 * press, and a second could send two admins to two different panels for one fault.
 */
const SPAN_TOO_SHORT_REPAIR = "Verlege im Abschnitt Zeitraum das Enddatum nach hinten oder das Startdatum nach vorne und speichere die Saison.";

/** Inclusive as `find_saison_span_refusal` counts: a season running one day offers one. */
function offeredDays(startDate: string, endDate: string): number {
  return (Date.parse(endDate) - Date.parse(startDate)) / MS_PER_DAY + 1;
}

/**
 * `REQ-SPIELPLAN-005`'s window, mirroring the two figures
 * `fl_backend/app/api/saisons/services.py :: find_spielplan_refusal` weighs a confirmed replace
 * against. Private: the reason below is the whole of what reads it.
 */
function isReplaceWindowOpen({ saisonStatus, erfassteSpieleCount }: SpielplanControlInput): boolean {
  return saisonStatus === "future" && erfassteSpieleCount === 0;
}

/** The undraw's half of the same input. The bracket and the span describe a draw a removal never makes. */
export type UndrawControlInput = Omit<SpielplanControlInput, "hasKoRunden" | "startDate" | "endDate" | "vorschauSpieltage" | "gruppen">;

/**
 * **One expression for every reader**: the replace flag, the reason gating it, the undraw's offer and
 * the panel's own state badge and tone must agree on what "drawn" means, or a copy could confirm a
 * replace on a season the undraw considers empty.
 */
export function spielplanHoldsADraw({ hasSpielplan, hasDrawnSpiele, spieltageCount }: UndrawControlInput): boolean {
  return hasSpielplan || hasDrawnSpiele || spieltageCount > 0;
}

/**
 * Why the draw is closed, or `null` while it is on offer. **A courtesy and not the control**: the
 * draw endpoint refuses each of these itself, over its own refusal passes, and this only stops the
 * page offering an act it already knows the answer to.
 */
export function spielplanBlockedReason(input: SpielplanControlInput): string | null {
  const { saisonStatus, hasKoRunden, startDate, endDate, vorschauSpieltage } = input;

  // Ahead of the window, unlike `find_spielplan_refusal`: a season that is over is answered by the
  // state it stands in, which neither closure has a way out of. `past` alone, or a season
  // activated undrawn would be unschedulable for good.
  if (saisonStatus === "past") return "Diese Saison ist abgeschlossen. Für sie wird kein Spielplan mehr angelegt.";

  // `REQ-SPIELPLAN-001` and `REQ-SPIELPLAN-002` each step aside for a confirmed replace, and this
  // page confirms one wherever there is something to destroy, so neither closes the control alone.
  // The window below bounds the offer instead.
  const replacesDraw = spielplanHoldsADraw(input);

  if (replacesDraw && !isReplaceWindowOpen(input)) {
    // One code, two sentences: nothing returns `status` to `future` (`docs/backend/spec.md :: I18`),
    // while `PATCH /spiele/{spiel_id}` rewrites every recorded field. Only the record half has a way
    // back, so only it is worded as a state.
    return saisonStatus === "active"
      ? "Der Spielplan lässt sich für laufende Saisons nicht neu anlegen."
      : `In dieser Saison ist schon etwas eingetragen: ${RECORDED_FACTS_ANY}. Neu anlegen lässt sich der Spielplan erst wieder, wenn bei keinem Spiel mehr etwas davon eingetragen ist.`;
  }

  // Nothing past the window for a replace, which draws from the panel's boxes and not the stored rules:
  // closing it here unmounts the very boxes that repair it. `spielplanShapeBlockedReason` closes its press.
  if (replacesDraw) return null;

  if (drawGruppenRefusal(input.gruppen) !== null) return GRUPPEN_OFF_RULES;

  // After the groups, as the endpoint asks it: `find_rules_refusal` runs after the whole spielplan
  // pass, and on its `stored=None` path `REQ-RULES-014` reduces to a qualifier product reaching no
  // bracket, which is exactly an empty knockout list.
  if (!hasKoRunden) return "Aus diesen Regeln entsteht keine KO-Runde. Ändere die Zahlen im Abschnitt Regeln und speichere sie.";

  // Last, as `find_saison_span_refusal` runs after the rules: no bracket implies no matchday count
  // worth measuring.
  if (offeredDays(startDate, endDate) < vorschauSpieltage)
    return `Der Zeitraum dieser Saison ist zu kurz für die Spieltage, die sich aus ihren Regeln ergeben. ${SPAN_TOO_SHORT_REPAIR}`;

  return null;
}

/**
 * A REPLACE's press over the numbers in its boxes, apart from `spielplanBlockedReason`, whose closure
 * unmounts the boxes that repair it. In the endpoint's order, the span weighed against the matchdays
 * the SENT numbers imply.
 */
export function spielplanShapeBlockedReason({
  shape,
  occupancy,
  startDate,
  endDate,
}: {
  shape: FLSpielplanShape;
  occupancy: SaisonGruppenOccupancy;
  /** The season's STORED span, which the draw weighs the sent numbers against. */
  startDate: string;
  endDate: string;
}): string | null {
  const refusal = drawShapeRefusal({ shape, occupancy });

  if (refusal === "gruppenOffSize" || refusal === "groupsInUse") return GRUPPEN_OFF_RULES;
  // `REQ-RULES-001` refuses a bracket too large and one with no shape alike, in one sentence.
  if (refusal !== null) return "Aus diesen Zahlen entsteht keine KO-Runde. Ändere die Gruppen oder die Qualifikanten pro Gruppe.";

  if (offeredDays(startDate, endDate) < drawnSpieltage(shape))
    return `Der Zeitraum dieser Saison ist zu kurz für die Spieltage, die sich aus diesen Zahlen ergeben. ${SPAN_TOO_SHORT_REPAIR}`;

  return null;
}

/** The two writes the Spielplan panel offers, keyed as its operation picker reads them back. */
export type SpielplanOperation = "anlegen" | "zuruecknehmen";

/**
 * The Spielplan panel's one press: which write it makes, and why it stands closed. The draw is the operation
 * wherever the reader has not picked, being the panel's primary act, and the undraw is never on offer without it.
 */
export function spielplanPress({
  input,
  picked,
  shape,
}: {
  input: SpielplanControlInput;
  /** Honoured only while both writes stand open: anywhere else a pick left standing names a write the page does not offer. */
  picked: SpielplanOperation | null;
  /** The numbers in the replace's boxes, which judge its press and nothing else. */
  shape: FLSpielplanShape;
}): { bothOpen: boolean; operation: SpielplanOperation; isUnchosen: boolean; standingReason: string | null; closedReason: string | null } {
  const drawBlockedReason = spielplanBlockedReason(input);
  const undrawBlockedReason = spielplanUndrawBlockedReason(input);
  const bothOpen = drawBlockedReason === null && undrawBlockedReason === null;

  const operation = bothOpen && picked !== null ? picked : "anlegen";
  const isUnchosen = bothOpen && picked === null;
  const isReplacing = operation === "anlegen" && spielplanReplacesDraw(input);

  // A replace's groups refusal stands on the page where the clubs fit no offered shape: no step in the boxes lifts
  // it, and the team page is the repair (`docs/frontend/spec.md` §1.14).
  const standingReason =
    (operation === "anlegen" ? drawBlockedReason : undrawBlockedReason) ??
    (isReplacing && !fitsAnOfferedShape(input.gruppen.occupancy) ? GRUPPEN_OFF_RULES : null);

  // Said on the control alone rather than in the panel's body, where a pick or a step would take it away under
  // the reader's hands (`docs/frontend/spec.md` §1.14).
  const closedReason = isUnchosen
    ? "Wähle „Neu anlegen“ oder „Zurücknehmen“."
    : (standingReason ??
      (isReplacing
        ? spielplanShapeBlockedReason({ shape, occupancy: input.gruppen.occupancy, startDate: input.startDate, endDate: input.endDate })
        : null));

  return { bothOpen, operation, isUnchosen, standingReason, closedReason };
}

/**
 * Whether the offered press DESTROYS the matchdays and fixtures the season holds.
 *
 * **Derived through `spielplanBlockedReason`, never beside it**: a flag decided alone could confirm
 * a replace the reason function has already closed the control for.
 */
export function spielplanReplacesDraw(input: SpielplanControlInput): boolean {
  return spielplanBlockedReason(input) === null && spielplanHoldsADraw(input);
}

/**
 * The undraw's half of the same question, and **a courtesy rather than the control** exactly as the
 * draw's above is: `fl_backend/app/api/saisons/services.py :: find_undraw_refusal` decides it.
 */
export function spielplanUndrawBlockedReason(input: UndrawControlInput): string | null {
  const { saisonStatus, erfassteSpieleCount } = input;

  // This panel's own condition rather than the endpoint's: an undraw of an undrawn season is answered
  // 200 with zeroes, so pressing would ask an admin to confirm the destruction of nothing.
  if (!spielplanHoldsADraw(input)) return "Diese Saison hat keinen Spielplan. Es gibt nichts zurückzunehmen.";

  // The replace's split over the same window: a status sentence names a boundary nothing reopens, a
  // record sentence names a state an admin can leave (`blockedReasons.ts :: spielplanBlockedReason`).
  if (saisonStatus !== "future") return "Zurücknehmen lässt sich der Spielplan nur, solange die Saison geplant ist.";

  if (erfassteSpieleCount > 0)
    return `In dieser Saison ist schon etwas eingetragen: ${RECORDED_FACTS_ANY}. Zurücknehmen lässt sich der Spielplan erst wieder, wenn bei keinem Spiel mehr etwas davon eingetragen ist.`;

  return null;
}

/**
 * Why the rollover is closed, or `null` while it is on offer. `REQ-ACTIVATE-002` is absent because
 * a `past` season closes the whole panel instead: it has no remedy to name, and a hint would
 * promise a route the system does not have.
 */
export function rolloverBlockedReason({
  hasDrawnSpiele,
  hasUndatierteSpieltage,
  outgoingSaisonId,
  offeneSpieleCount,
}: {
  /** `REQ-ACTIVATE-003`: whether THIS season holds fixtures of its own. */
  hasDrawnSpiele: boolean;
  /** `REQ-ACTIVATE-004`'s condition: whether any of THIS season's matchdays carries no `beginn`. */
  hasUndatierteSpieltage: boolean;
  /** The season the rollover would close, or `null` when nothing holds `active`. */
  outgoingSaisonId: string | null;
  /** `REQ-ACTIVATE-001`'s condition, counted over the OUTGOING season. */
  offeneSpieleCount: number;
}): string | null {
  // Ahead of the incumbent's open fixtures, as
  // `fl_backend/app/api/saisons/services.py :: find_activation_refusal` orders them: an incumbent
  // an admin can go and finish is beside the point where this season may not be promoted at all.
  if (!hasDrawnSpiele) return "Umstellen geht erst, wenn diese Saison einen Spielplan hat. Lege ihn im Abschnitt Spielplan an.";

  // After the draw for the endpoint's reason: an undrawn season holds no matchday to date, so this
  // sentence would name a repair nobody can make.
  if (hasUndatierteSpieltage) return SPIELTAGE_UNDATED;

  // Nothing holds `active` on a fresh database, so there is no outgoing season to be unfinished and
  // that first rollover stays live.
  if (outgoingSaisonId !== null && offeneSpieleCount > 0)
    return "Umstellen geht erst, wenn die laufende Saison keine offenen Spiele mehr hat. Trage die fehlenden Ergebnisse ein oder sage die Spiele ab.";

  return null;
}
