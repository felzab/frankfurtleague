import type { FLSaisonStatus } from "@/features/saisons/schemas";

/**
 * Why the draw is closed, or `null` while it is on offer. **A courtesy and not the control**: the
 * draw endpoint refuses each of these itself, over both its refusal passes, and this only stops the
 * page offering an act it already knows the answer to.
 */
export function spielplanBlockedReason({
  saisonStatus,
  hasSpielplan,
  hasDrawnSpiele,
  spieltageCount,
  hasKoRunden,
}: {
  saisonStatus: FLSaisonStatus;
  /** Whether the season carries the generator's watermark. */
  hasSpielplan: boolean;
  /** `REQ-SPIELPLAN-001`: the season already holds fixtures, whoever put them there. */
  hasDrawnSpiele: boolean;
  /** `REQ-SPIELPLAN-002`'s condition: how many matchday rows the season holds, retired ones included. */
  spieltageCount: number;
  /** Whether the season's served schedule reaches a knockout round at all. */
  hasKoRunden: boolean;
}): string | null {
  if (hasSpielplan) return "Der Spielplan dieser Saison wurde schon angelegt. Er entsteht genau einmal.";

  // `past` alone, never `future`-only, as
  // `fl_backend/app/api/saisons/services.py :: find_spielplan_refusal` has it: the rollover is
  // one-way, so a season activated undrawn would be unschedulable for good if this closed on it.
  if (saisonStatus === "past") return "Diese Saison ist abgeschlossen. Für sie wird kein Spielplan mehr angelegt.";

  if (hasDrawnSpiele) return "Für diese Saison sind schon Spiele angelegt. Ein Spielplan entsteht nur für eine Saison ganz ohne Spiele.";
  if (spieltageCount > 0) return "Für diese Saison gibt es schon Spieltage. Ein Spielplan entsteht nur für eine Saison ganz ohne Spieltage.";

  // Last, as the endpoint asks it: `find_rules_refusal` runs after the whole spielplan pass, and on
  // its `stored=None` path `REQ-RULES-001` reduces to a qualifier product reaching no bracket, which
  // is exactly an empty knockout list.
  if (!hasKoRunden) return "Aus diesen Regeln entsteht keine KO-Runde. Ändere die Zahlen im Abschnitt Regeln und speichere sie.";

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
  if (outgoingSaisonId !== null && offeneSpieleCount > 0) return "Umstellen geht erst, wenn die laufende Saison keine offenen Spiele mehr hat.";

  return null;
}
