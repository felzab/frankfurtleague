import type { FLSaisonPhase, FLSonderereignis } from "@/core/generated/client/types";

/** A side as the rule reads it: its goals alone, `null` while none are entered. */
type Side = { readonly tore: number | null } | null;

/**
 * Whether a fixture takes a shoot-out: a knockout match whose two sides' goals are entered and level, and which no
 * no-show decided. The write keeps a shoot-out on exactly these and drops it anywhere else
 * (`fl_backend/app/api/spiele/services.py :: apply_payload_to_spiel`), so the match editor and the referee's report
 * offer the pair where it would stand.
 */
export function admitsShootOut(saisonPhase: FLSaisonPhase, team1: Side, team2: Side, sonderereignis: FLSonderereignis | null): boolean {
  if (saisonPhase === "gruppenphase") return false;

  // A no-show's award is composed from the season's `forfeit_ergebnis`, which a grandfathered season may hold level, so a
  // kept shoot-out would advance the club that never appeared.
  if (sonderereignis === "nichtantreten_team1" || sonderereignis === "nichtantreten_team2") return false;

  const tore1 = team1?.tore ?? null;
  const tore2 = team2?.tore ?? null;
  return tore1 !== null && tore2 !== null && tore1 === tore2;
}
