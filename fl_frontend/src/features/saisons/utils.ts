import type { NextPageProps } from "@/shared/types/types";
import type { FLSpiel } from "../spiele/schemas";
import type { SaisonGruppenSwapContext, SaisonSpieltagBound, SaisonSwapTeam } from "./types";

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
 * **Mirrors `fl_backend/app/api/saisons/admin_router.py :: _has_taken_place` and has to stay one**:
 * the endpoint refuses on its answer and the swap surfaces offer on the same one.
 */
function hasTakenPlace(spiel: FLSpiel): boolean {
  // **This set is the swap's alone.** An abandonment and a no-show each leave a record the exchange
  // would rewrite; `ausgefallen` and `annulliert` leave none, so neither belongs here however much
  // they read like the others.
  const leftARecord =
    spiel.sonderereignis === "abgebrochen" || spiel.sonderereignis === "nichtantreten_team1" || spiel.sonderereignis === "nichtantreten_team2";

  // The goal counts are the clause a reader would not predict: a fixture with two clubs and one count
  // entered is stored holding goals and no `ergebnis`. `?? null` keeps an absent side out of that.
  return spiel.ergebnis !== null || leftARecord || (spiel.team1?.tore ?? null) !== null || (spiel.team2?.tore ?? null) !== null;
}

/**
 * Club id → Spieltag id → fixtures. Counted rather than collected into a set: two fixtures of one club
 * on one Spieltag is exactly the state `REQ-SWAP-005` is about, and a set would erase it.
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
 * offers what the other refuses. **`REQ-SWAP-005` is a fact about the PAIR**, so each club carries
 * its fixtures per Spieltag rather than one number.
 */
export function buildGruppenSwapContext({
  teams,
  gruppenSpiele,
  playoffSpiele,
}: {
  teams: readonly { id: string; name: string; gruppe: SaisonSwapTeam["gruppe"] }[];
  gruppenSpiele: readonly FLSpiel[];
  playoffSpiele: readonly FLSpiel[];
}): SaisonGruppenSwapContext {
  const gespieltePerTeam = new Map<string, number>();
  for (const spiel of gruppenSpiele) {
    if (!hasTakenPlace(spiel)) continue;
    for (const seite of [spiel.team1, spiel.team2]) {
      if (seite !== null) gespieltePerTeam.set(seite.team_id, (gespieltePerTeam.get(seite.team_id) ?? 0) + 1);
    }
  }

  const gruppenSpieltage = countSpieleProSpieltag(gruppenSpiele);
  const koSpieltage = countSpieleProSpieltag(playoffSpiele);

  return {
    teams: teams.map((team) => ({
      id: team.id,
      name: team.name,
      gruppe: team.gruppe,
      gespielteGruppenSpiele: gespieltePerTeam.get(team.id) ?? 0,
      gruppenSpieleProSpieltag: gruppenSpieltage.get(team.id) ?? {},
      koSpieleProSpieltag: koSpieltage.get(team.id) ?? {},
    })),
    playedKnockoutSpiele: playoffSpiele.filter(hasTakenPlace).length,
  };
}

/**
 * **`REQ-SWAP-005` in the form, mirroring `_spieltag_clashes`.** Only a Spieltag the exchange BREAKS
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
export type SwapPartnerRefusal = "self" | "sameGruppe" | "played" | "spieltagClash";

/**
 * **`find_gruppe_swap_refusal`'s per-candidate half, in its order**, so a control's reason is the
 * endpoint's. Silent about `REQ-SWAP-002` and `REQ-SWAP-003`: those refuse every pair alike and
 * belong where a surface closes the control.
 */
export function findSwapPartnerRefusal(fixed: SaisonSwapTeam, candidate: SaisonSwapTeam): SwapPartnerRefusal | null {
  if (candidate.id === fixed.id) return "self";
  if (candidate.gruppe === fixed.gruppe) return "sameGruppe";
  if (candidate.gespielteGruppenSpiele > 0) return "played";
  if (wouldFieldAClubTwice(fixed, candidate)) return "spieltagClash";

  return null;
}

/**
 * The generator's two counts as one phrase, in the NOMINATIVE so both call sites can seat it
 * unchanged. The singular is a defence: the smallest season `REQ-RULES-001` allows draws two of
 * each, and these counts arrive from the server.
 */
export function describeSpielplanUmfang(spieltage: number, spiele: number): string {
  const spieltagePhrase = spieltage === 1 ? "ein Spieltag" : `${String(spieltage)} Spieltage`;
  const spielePhrase = spiele === 1 ? "ein Spiel" : `${String(spiele)} Spiele`;

  return `${spieltagePhrase} und ${spielePhrase}`;
}

/**
 * **The nulls come out before the sort.** `Array.prototype.sort` with no comparator orders by the
 * STRINGIFIED value, where `null` becomes `"null"` and sorts after every ISO date, so one undated
 * matchday would take the last position and drop `endMin`.
 */
export function buildSpieltagBound(spieltage: readonly { beginn: string | null; ende: string | null }[]): SaisonSpieltagBound {
  // Sorted in place: `filter` has already produced arrays nothing else holds.
  const beginne = spieltage.map((spieltag) => spieltag.beginn).filter((datum) => datum !== null);
  const enden = spieltage.map((spieltag) => spieltag.ende).filter((datum) => datum !== null);

  // Lexicographic order IS date order on YYYY-MM-DD, so no comparator is needed once the nulls are gone.
  return { startMax: beginne.sort()[0] ?? null, endMin: enden.sort().at(-1) ?? null };
}
