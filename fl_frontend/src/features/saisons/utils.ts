/**
 * SAISONS · pure derivations
 *
 * No fetching and no framework: everything here is a function of its arguments, which is what makes it
 * testable without a request. `resolvers.ts` decides WHEN to navigate; this decides WHERE to.
 */

import type { NextPageProps } from "@/shared/types/types";
import type { FLSpiel } from "../spiele/schemas";
import type { SaisonGruppenSwapContext, SaisonSwapTeam } from "./types";

/**
 * The current query string minus `saison_id`, as a relative reference.
 *
 * Relative on purpose: a Server Component cannot read its own pathname, and "this page, one parameter
 * fewer" is exactly what a query-only reference means — so this stays correct if a route ever moves,
 * where a hardcoded path per call site would not. Next resolves it against the current URL on both
 * paths a `redirect()` can take: `new URL(href, location.href)` in the client router, and the
 * document's base URL in the streamed `<meta http-equiv="refresh">` fallback.
 *
 * **`"?"` when nothing else survives, never `""`.** An empty `Location` names no resource, while `"?"`
 * resolves to the same page with an empty query — and `URL.search` is `""` for a bare `?`, so the
 * router's canonical href drops it and the address bar shows the clean path.
 *
 * Every other parameter is preserved, repeats included: a facet selection and a sort survive having
 * an unknown season taken out from under them.
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
 * Whether this fixture is one that happened, as both swap windows ask it.
 *
 * **The mirror of `fl_backend/app/api/saisons/admin_router.py :: _has_taken_place`, and it has to stay
 * one.** The endpoint refuses on its answer and every surface offering a swap decides what to offer on
 * the same answer, so a clause on one side and not the other either offers a pair the write path 409s
 * or hides a swap that would have worked.
 *
 * The goal counts are the clause a reader would not predict: `PATCH /spiele/{spiel_id}` derives
 * `ergebnis` from BOTH counts and drops the goals only when a SIDE is absent, so a fixture with two
 * clubs on it and one count entered is stored holding goals and no result. Somebody typed that number
 * about a match that was played.
 *
 * Not built from `computeSpielStatus`: a status label is not a filter and `ausstehend` is not a
 * partition.
 */
function hasTakenPlace(spiel: FLSpiel): boolean {
  // `?? null` collapses the two absences into one: an unresolved slot has no side at all and a resolved
  // one can hold no goals, and only a real count should read as a fixture that happened.
  return spiel.ergebnis !== null || spiel.is_canceled || (spiel.team1?.tore ?? null) !== null || (spiel.team2?.tore ?? null) !== null;
}

/**
 * Club id → Spieltag id → how many of these fixtures that club is fielded in on that Spieltag.
 *
 * Counted rather than collected into a set, because two fixtures of one club on one Spieltag is exactly
 * the state `REQ-SWAP-005` is about and a set would erase it. Fed the group fixtures and the playoff
 * ones separately, which is the split the rule turns on: a swap moves the first and leaves the second.
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
 * Everything a swap control stands on, assembled from one season's clubs and its two fixture sets —
 * and assembled HERE rather than at each page, because both entry points have to answer
 * `find_gruppe_swap_refusal`'s questions identically or one of them offers what the other refuses.
 *
 * `teams` is the season's junction rows, which the strict join makes `GET /teams?saison_id=`: a club
 * with no row is absent from it and is precisely the club the write path refuses. The knockout count is
 * season-wide, because `REQ-SWAP-002` asks whether the bracket consumed a standing whoever it named;
 * the per-club one is narrowed to that club's own Gruppenphase fixtures, which is the grain
 * `REQ-SWAP-004` asks about.
 *
 * **`REQ-SWAP-005` is the one that cannot be reduced to a per-club number**, because whether an exchange
 * doubles a club on a Spieltag is a fact about the PAIR. So each club carries its fixtures counted per
 * Spieltag, split by whether a swap would move them, and `wouldFieldAClubTwice` decides over the two.
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
 * Whether exchanging these two clubs would leave one of them in two matches of one Spieltag.
 *
 * **`REQ-SWAP-005` said in the form, mirroring `_spieltag_clashes` on the server.** A swap
 * moves each club's Gruppenphase fixtures to the other and leaves the bracket ones where they are, so
 * afterwards a club stands in its OWN `koSpieleProSpieltag` plus the OTHER's `gruppenSpieleProSpieltag`.
 * A club plays at most one match per Spieltag.
 *
 * **Only a Spieltag the exchange BREAKS counts, never one already broken.** The server draws the line in
 * the same place, because enforcement leaves stored breaches alone — and a stricter client would hide
 * a swap the endpoint accepts.
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
 * Why exchanging `fixed` with `candidate` would be refused, or `null` when the pair is a swap.
 *
 * **`find_gruppe_swap_refusal`'s per-candidate half, in its order.** `self` and `sameGruppe` are
 * `REQ-SWAP-001`, `played` is `REQ-SWAP-004` and `spieltagClash` is `REQ-SWAP-005` — and the order is
 * the endpoint's, so the reason a control shows is the reason the endpoint would have given.
 *
 * Deliberately silent about the whole-season windows. `REQ-SWAP-002` and `REQ-SWAP-003` refuse every
 * pair alike, so they belong where a surface closes the control rather than where it grades a row;
 * naming a season-wide bound against one club would send an admin to look at that club.
 *
 * `fixed`'s own participation is not read here either — a club that has played cannot be either side,
 * which is the same whole-control answer rather than a fact about the candidate.
 */
export function findSwapPartnerRefusal(fixed: SaisonSwapTeam, candidate: SaisonSwapTeam): SwapPartnerRefusal | null {
  if (candidate.id === fixed.id) return "self";
  if (candidate.gruppe === fixed.gruppe) return "sameGruppe";
  if (candidate.gespielteGruppenSpiele > 0) return "played";
  if (wouldFieldAClubTwice(fixed, candidate)) return "spieltagClash";

  return null;
}
