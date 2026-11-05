import type { NextPageProps } from "@/shared/types/types";
import type { FLSpiel, FLSpielTeamField } from "../spiele/types";
import type { SaisonGruppenSwapContext, SaisonSwapTeam } from "./types";

/**
 * The query string minus `saison_id`, relative on purpose: a Server Component cannot read its own
 * pathname, and Next resolves a query-only reference against the current URL.
 *
 * **`"?"` and never `""`**: an empty `Location` names no resource.
 */
export function searchWithoutSaisonId(searchParams: Awaited<NextPageProps["searchParams"]>): string {
  const remaining = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (key === "saison_id" || value === undefined) continue;
    for (const entry of Array.isArray(value) ? value : [value]) remaining.append(key, entry);
  }

  const query = remaining.toString();

  return query === "" ? "?" : `?${query}`;
}

/**
 * **Mirrors `fl_backend/app/api/teams/services.py :: has_taken_place`**, which closes a fixture's
 * Spielbestätigung. Wider closes a control the endpoint accepts, narrower offers one it refuses.
 */
export function hasTakenPlace(
  spiel: Pick<FLSpiel, "ergebnis" | "sonderereignis" | "elfmeterschiessen"> & {
    team1: Pick<FLSpielTeamField, "tore"> | null;
    team2: Pick<FLSpielTeamField, "tore"> | null;
  },
): boolean {
  // **The set is this question's alone, never `SONDEREREIGNIS_RECORDING_AN_ABSENCE`.** An
  // abandonment and a no-show each left a record; `ausgefallen` and `annulliert` leave none, so
  // neither belongs here however much they read like the others.
  const leftARecord =
    spiel.sonderereignis === "abgebrochen" || spiel.sonderereignis === "nichtantreten_team1" || spiel.sonderereignis === "nichtantreten_team2";

  // A save keeps a shoot-out only beside a result, so one standing alone is the same hand-written
  // record of a decided tie as the lone goal count below, and a rewrite would destroy it.
  if (spiel.elfmeterschiessen !== null) return true;

  // The goal counts are the clause a reader would not predict: a fixture with two clubs and one count
  // entered is stored holding goals and no `ergebnis`. `?? null` keeps an absent side out of that.
  return spiel.ergebnis !== null || leftARecord || (spiel.team1?.tore ?? null) !== null || (spiel.team2?.tore ?? null) !== null;
}

// Session 6: the swap's client grading below goes with the old team editor, the season editor's pickers reading the
// grading its admin read serves.
/**
 * Club id → Spieltag id → fixtures. Counted rather than collected into a set: two fixtures of one club
 * on one Spieltag is exactly the state `swap_spieltag_clash` is about, and a set would erase it.
 */
function countSpieleProSpieltag(spiele: readonly FLSpiel[]): Map<string, Record<string, number>> {
  const perTeam = new Map<string, Record<string, number>>();

  for (const spiel of spiele) {
    for (const seite of [spiel.team1, spiel.team2]) {
      if (seite === null) continue;
      const proSpieltag = perTeam.get(seite.team_id) ?? {};
      proSpieltag[spiel.spieltag_id] = (proSpieltag[spiel.spieltag_id] ?? 0) + 1;
      perTeam.set(seite.team_id, proSpieltag);
    }
  }

  return perTeam;
}

/**
 * Assembled HERE because both entry points must answer `find_gruppe_swap_refusal` identically, or one
 * offers what the other refuses. **`swap_spieltag_clash` is a fact about the PAIR**, so each club carries
 * its fixtures per Spieltag rather than one number.
 */
export function buildGruppenSwapContext({
  teams,
  gruppenSpiele,
  playoffSpiele,
  begonnen,
}: {
  teams: readonly { id: string; name: string; gruppe: SaisonSwapTeam["gruppe"] }[];
  gruppenSpiele: readonly FLSpiel[];
  playoffSpiele: readonly FLSpiel[];
  /** The season's own answer on its admin read, `has_started`'s, never a date compared here. */
  begonnen: boolean;
}): SaisonGruppenSwapContext {
  const gruppenSpieltage = countSpieleProSpieltag(gruppenSpiele);
  const koSpieltage = countSpieleProSpieltag(playoffSpiele);

  return {
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      gruppe: team.gruppe,
      gruppenSpieleProSpieltag: gruppenSpieltage.get(team.id) ?? {},
      koSpieleProSpieltag: koSpieltage.get(team.id) ?? {},
    })),
    hasStarted: begonnen,
  };
}

/**
 * **`swap_spieltag_clash` in the form, mirroring `_spieltag_clashes`.** Only a Spieltag the exchange BREAKS
 * counts, never one already broken — hence the `vorher <= 1`; a stricter client would hide a swap the
 * endpoint accepts.
 */
function wouldFieldAClubTwice(first: SaisonSwapTeam, second: SaisonSwapTeam): boolean {
  const breaksASpieltag = (keeps: SaisonSwapTeam, gives: SaisonSwapTeam) =>
    // Its own bracket Spieltage plus the ones it inherits — every Spieltag its count can move on.
    [...Object.keys(keeps.koSpieleProSpieltag), ...Object.keys(gives.gruppenSpieleProSpieltag)].some((spieltagId) => {
      const bleibt = keeps.koSpieleProSpieltag[spieltagId] ?? 0;
      const vorher = bleibt + (keeps.gruppenSpieleProSpieltag[spieltagId] ?? 0);
      const nachher = bleibt + (gives.gruppenSpieleProSpieltag[spieltagId] ?? 0);

      return nachher > 1 && vorher <= 1;
    });

  return breaksASpieltag(first, second) || breaksASpieltag(second, first);
}

/** Why `candidate` cannot be the other side of a swap with `fixed`. Each surface words these itself. */
export type SwapPartnerRefusal = "self" | "sameGruppe" | "spieltagClash";

/**
 * **`find_gruppe_swap_refusal`'s per-candidate half, in its order**, so a control's reason is the
 * endpoint's. Silent about `swap_saison_started` and `saison_past`: those refuse every pair alike and
 * belong where a surface closes the control.
 */
export function findSwapPartnerRefusal(fixed: SaisonSwapTeam, candidate: SaisonSwapTeam): SwapPartnerRefusal | null {
  if (candidate.id === fixed.id) return "self";
  if (candidate.gruppe === fixed.gruppe) return "sameGruppe";
  if (wouldFieldAClubTwice(fixed, candidate)) return "spieltagClash";

  return null;
}

/** A matchday count as a phrase, for the old matchday list's readout. */
export function describeSpieltageCount(spieltage: number): string {
  return spieltage === 1 ? "ein Spieltag" : `${String(spieltage)} Spieltage`;
}
