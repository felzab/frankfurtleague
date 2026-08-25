import type { FLSaisonStatus } from "@/features/saisons/schemas";

/** Everything both halves of the draw control's state are decided from, read from one page render. */
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

/**
 * Why the draw is closed, or `null` while it is on offer. **A courtesy and not the control**: the
 * draw endpoint refuses each of these itself, over both its refusal passes, and this only stops the
 * page offering an act it already knows the answer to.
 */
export function spielplanBlockedReason(input: SpielplanControlInput): string | null {
  const { saisonStatus, hasSpielplan, hasDrawnSpiele, spieltageCount, hasKoRunden } = input;

  // `REQ-SPIELPLAN-001` and `REQ-SPIELPLAN-002` each step aside for a confirmed replace, and this
  // page confirms one wherever there is something to destroy, so neither closes the control alone.
  // The window below bounds the offer instead.
  const replacesDraw = hasSpielplan || hasDrawnSpiele || spieltageCount > 0;

  // Ahead of the `past` freeze, exactly as `find_spielplan_refusal` orders the two: an admin whose
  // press would replace reads the whole window rather than the half of it a status names.
  if (replacesDraw && !isReplaceWindowOpen(input)) {
    // Both halves under one condition, as `REQ-SPIELPLAN-005` is one code: neither names work an
    // admin can go and do, so each sentence only says which half closed the window.
    return saisonStatus !== "future"
      ? "Der Spielplan dieser Saison steht. Neu anlegen lässt er sich nur, solange die Saison geplant ist."
      : "In dieser Saison ist schon etwas eingetragen: ein Ergebnis, ein Ausfall, ein Ort, ein Schiedsrichter oder eine Notiz. Der Spielplan lässt sich dann nicht mehr neu anlegen.";
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
  return spielplanBlockedReason(input) === null && (input.hasSpielplan || input.hasDrawnSpiele || input.spieltageCount > 0);
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
  if (outgoingSaisonId !== null && offeneSpieleCount > 0) return "Umstellen geht erst, wenn die laufende Saison keine offenen Spiele mehr hat.";

  return null;
}
