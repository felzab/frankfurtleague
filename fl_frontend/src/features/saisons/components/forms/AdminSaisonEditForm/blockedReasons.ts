import { RECORDED_FACTS_ANY } from "@/features/saisons/constants";

import type { FLSaisonStatus } from "@/features/saisons/schemas";

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
  /** Whether the season's served schedule reaches a knockout round at all. */
  hasKoRunden: boolean;
};

/**
 * `REQ-SPIELPLAN-005`'s window, mirroring the two figures
 * `fl_backend/app/api/saisons/services.py :: find_spielplan_refusal` weighs a confirmed replace
 * against. Private: the reason below is the whole of what reads it.
 */
function isReplaceWindowOpen({ saisonStatus, erfassteSpieleCount }: SpielplanControlInput): boolean {
  return saisonStatus === "future" && erfassteSpieleCount === 0;
}

/** The undraw's half of the same input. `hasKoRunden` describes a bracket a removal never draws. */
export type UndrawControlInput = Omit<SpielplanControlInput, "hasKoRunden">;

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
 * draw endpoint refuses each of these itself, over both its refusal passes, and this only stops the
 * page offering an act it already knows the answer to.
 */
export function spielplanBlockedReason(input: SpielplanControlInput): string | null {
  const { saisonStatus, hasKoRunden } = input;

  // `REQ-SPIELPLAN-001` and `REQ-SPIELPLAN-002` each step aside for a confirmed replace, and this
  // page confirms one wherever there is something to destroy, so neither closes the control alone.
  // The window below bounds the offer instead.
  const replacesDraw = spielplanHoldsADraw(input);

  // Ahead of the `past` freeze, exactly as `find_spielplan_refusal` orders the two: an admin whose
  // press would replace reads the whole window rather than the half of it a status names.
  if (replacesDraw && !isReplaceWindowOpen(input)) {
    // One code, two sentences: nothing returns `status` to `future` (`docs/backend/spec.md :: I18`),
    // while `PATCH /spiele/{spiel_id}` rewrites every recorded field. Only the record half has a way
    // back, so only it is worded as a state.
    return saisonStatus !== "future"
      ? "Der Spielplan dieser Saison steht. Neu anlegen lässt er sich nur, solange die Saison geplant ist."
      : `In dieser Saison ist schon etwas eingetragen: ${RECORDED_FACTS_ANY}. Neu anlegen lässt sich der Spielplan erst wieder, wenn bei keinem Spiel mehr etwas davon eingetragen ist.`;
  }

  // `past` alone, never `future`-only, as
  // `fl_backend/app/api/saisons/services.py :: find_spielplan_refusal` has it: the rollover is
  // one-way, so a season activated undrawn would be unschedulable for good if this closed on it.
  if (saisonStatus === "past") return "Diese Saison ist abgeschlossen. Für sie wird kein Spielplan mehr angelegt.";

  // Last, as the endpoint asks it: `find_rules_refusal` runs after the whole spielplan pass, and on
  // its `stored=None` path `REQ-RULES-001` reduces to a qualifier product reaching no bracket, which
  // is exactly an empty knockout list.
  if (!hasKoRunden) return "Aus diesen Regeln entsteht keine KO-Runde. Ändere die Zahlen im Abschnitt Regeln und speichere sie.";

  return null;
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
  outgoingSaisonId,
  offeneSpieleCount,
}: {
  /** `REQ-ACTIVATE-003`: whether THIS season holds fixtures of its own. */
  hasDrawnSpiele: boolean;
  /** The season the rollover would close, or `null` when nothing holds `active`. */
  outgoingSaisonId: string | null;
  /** `REQ-ACTIVATE-001`'s condition, counted over the OUTGOING season. */
  offeneSpieleCount: number;
}): string | null {
  // Ahead of the incumbent's open fixtures, as
  // `fl_backend/app/api/saisons/services.py :: find_activation_refusal` orders them: an incumbent
  // an admin can go and finish is beside the point where this season may not be promoted at all.
  if (!hasDrawnSpiele) return "Umstellen geht erst, wenn diese Saison einen Spielplan hat. Lege ihn im Abschnitt Spielplan an.";

  // Nothing holds `active` on a fresh database, so there is no outgoing season to be unfinished and
  // that first rollover stays live.
  if (outgoingSaisonId !== null && offeneSpieleCount > 0)
    return "Umstellen geht erst, wenn die laufende Saison keine offenen Spiele mehr hat. Trage die fehlenden Ergebnisse ein oder sage die Spiele ab.";

  return null;
}
