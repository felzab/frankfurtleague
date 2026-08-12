import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminSaisonEditView } from "@/features/saisons/components/views/AdminSaisonEditView";
import { getSaisons } from "@/features/saisons/queries";
import { resolveSaisonIdParam } from "@/features/saisons/resolvers";
import { getSpiele } from "@/features/spiele/queries";
import { getSpieltage } from "@/features/spieltage/queries";
import { getTeams } from "@/features/teams/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { PLACEHOLDER } from "@/shared/utils/format";

import type { SaisonGruppenSwapContext, SaisonOffeneSpiel, SaisonRolloverContext } from "@/features/saisons/types";
import type { FLSpiel } from "@/features/spiele/schemas";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The season editor (ADR-0040). One season per URL.
 *
 * **The season is the SEGMENT here, not the sidemenu selector's `?saison_id=`.** That is the opposite of
 * the club and player editors, and it follows from what the page edits: those two edit a season-scoped
 * junction row belonging to a club or a person, so the selector says which row; this page's subject IS a
 * season, so it is addressed by id and the selector has nothing to add.
 *
 * No `generateMetadata` and no `generateStaticParams`, for the reasons the match editor records. **The
 * page itself resolves NOTHING** — every await happens inside the `Suspense` boundary, which is what
 * keeps a fallback-params route renderable (the match editor documents the crash).
 */
export default function AdminSaisonEditPage(props: NextPageProps<{ saison_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <AdminSaisonEditContent params={props.params} />
    </Suspense>
  );
}

async function AdminSaisonEditContent({ params }: { params: NextPageProps<{ saison_id: string }>["params"] }) {
  await connection();
  const saisonId = await resolveSaisonIdParam(params);

  // The whole season list rather than `GET /saisons/{id}`: the rollover panel needs the OUTGOING season
  // too, which is whichever one holds `active` — a single read by id could not name it, and a second read
  // to find it would be the same list.
  const saisonsRes = await getSaisons();
  const saison = saisonsRes.saisons.find((candidate) => candidate.id === saisonId);
  if (!saison) {
    notFound();
  }

  const outgoing = saisonsRes.saisons.find((candidate) => candidate.status === "active") ?? null;
  const outgoingSaisonId = outgoing === null || outgoing.id === saison.id ? null : outgoing.id;

  // Retired matchdays come back too; the filter below drops them, because only the live ones bound the
  // dates. The flag keeps this page's cache key equal to the one `/admin/saisons` warms: that list
  // reads every season with it, and its rows link here.
  const [spieltageRes, outgoingSpieleRes, teamsRes, playoffSpieleRes, gruppenSpieleRes] = await Promise.all([
    getSpieltage({ saison_id: saison.id, include_inactive: true }),
    // Only fetched where there is something to warn about. A season that is already active has no
    // rollover to present, and one with no incumbent has no outgoing fixtures to check.
    outgoingSaisonId === null || saison.status === "active" ? Promise.resolve(null) : getSpiele({ saison_id: outgoingSaisonId }),
    // This season's clubs, for the swap control. `include_inactive` because this is an admin picker,
    // and hiding a retired club that still holds a junction row (ADR-0025) would make a swap the
    // endpoint accepts look impossible.
    getTeams({ saison_id: saison.id, include_inactive: true }),
    // `playoffs` is the query alias for "not gruppenphase" and is exactly the set `REQ-SWAP-002`
    // counts, so the page asks the endpoint's own question rather than fetching a whole season to
    // filter it here.
    getSpiele({ saison_id: saison.id, saison_phase: "playoffs" }),
    // The other half of the same question (`REQ-SWAP-004`), narrowed to the phase the rule asks about
    // for the reason the line above is: which clubs have already taken part in their group.
    getSpiele({ saison_id: saison.id, saison_phase: "gruppenphase" }),
  ]);

  /**
   * The outgoing season's unfinished matches — the precondition the ENDPOINT now enforces
   * (`REQ-ACTIVATE-001`, decided 2026-08-08), listed here so the block is actionable rather than a 409.
   *
   * **"Unfinished" is `ergebnis === null && !is_canceled`, and it mirrors `unplayed_spiel_nrs` exactly.**
   * Cancelling is the route past the refusal, so a cancelled fixture is settled: it is what turns a match
   * nobody will ever play into a decision somebody recorded. A cancelled match that DOES carry a result
   * is a forfeit and counts for the table (ADR-0019), so it is settled either way.
   *
   * The two definitions have to agree. If this list is empty while the endpoint refuses, the page shows a
   * live rollover button that always fails; if it is longer, the page blocks a rollover that would work.
   */
  const offeneSpiele: SaisonOffeneSpiel[] = (outgoingSpieleRes?.spiele ?? [])
    .filter((spiel) => spiel.ergebnis === null && !spiel.is_canceled)
    .map((spiel) => ({
      id: spiel.id,
      spielNr: spiel.spiel_nr,
      datum: spiel.datum,
      // A knockout slot the group phase has not filled has no team on that side — a normal state, so
      // the shared slot placeholder stands in. The provenance label is not resolved here: the
      // fixture's own page is where its wiring belongs.
      paarung: `${spiel.team1?.name ?? PLACEHOLDER.slot} – ${spiel.team2?.name ?? PLACEHOLDER.slot}`,
    }))
    .sort((left, right) => left.spielNr - right.spielNr);

  const rollover: SaisonRolloverContext = { outgoingSaisonId, offeneSpiele };

  /**
   * What the group swap control stands on (ADR-0062).
   *
   * **Every definition here has to agree with the endpoint's**, exactly as `offeneSpiele` agrees
   * with `unplayed_spiel_nrs` above. The club list is the season's junction rows, which the strict join
   * makes `GET /teams?saison_id=` — a club with no row is absent from it and is precisely the club the
   * write path refuses. Both fixture counts read "taken place" through `hasTakenPlace`, which is
   * `find_gruppe_swap_refusal`'s own reading said on this side. The knockout count is season-wide,
   * because `REQ-SWAP-002` asks whether the bracket consumed a standing whoever it named; the per-club
   * one is narrowed to that club's own Gruppenphase fixtures, which is the grain `REQ-SWAP-004` asks
   * about.
   *
   * **`REQ-SWAP-005` is the one that cannot be reduced to a per-club number**, because whether an
   * exchange doubles a club on a Spieltag is a fact about the PAIR. So the picker is handed each club's
   * fixtures counted per Spieltag, split by whether a swap would move them, and decides for itself. Both
   * reads already carry `spieltag_id`, so this costs no request.
   *
   * The grouped shape is never requested, so the narrowing below is a type guard rather than a branch
   * anything reaches.
   */
  const gespieltePerTeam = new Map<string, number>();
  for (const spiel of gruppenSpieleRes.spiele) {
    if (!hasTakenPlace(spiel)) continue;
    for (const seite of [spiel.team1, spiel.team2]) {
      if (seite !== null) gespieltePerTeam.set(seite.team_id, (gespieltePerTeam.get(seite.team_id) ?? 0) + 1);
    }
  }

  const gruppenSpieltage = countSpieleProSpieltag(gruppenSpieleRes.spiele);
  const koSpieltage = countSpieleProSpieltag(playoffSpieleRes.spiele);

  const swap: SaisonGruppenSwapContext = {
    teams:
      teamsRes.format === "list"
        ? teamsRes.teams.map((team) => ({
            id: team.id,
            name: team.name,
            gruppe: team.gruppe,
            gespielteGruppenSpiele: gespieltePerTeam.get(team.id) ?? 0,
            gruppenSpieleProSpieltag: gruppenSpieltage.get(team.id) ?? {},
            koSpieleProSpieltag: koSpieltage.get(team.id) ?? {},
          }))
        : [],
    playedKnockoutSpiele: playoffSpieleRes.spiele.filter(hasTakenPlace).length,
  };

  // The inner bound on the season's own dates (`REQ-DATE-004`): the start may not move past the first
  // live matchday's beginn, the end not before the last one's ende.

  // Retired matchdays do not bind — retiring is how a mis-dated one leaves the schedule. `undefined`
  // while the season has no live matchday, which leaves both pickers unbounded.
  const liveBeginne = spieltageRes.spieltage.filter((spieltag) => spieltag.inactive_since === null).map((spieltag) => spieltag.beginn);
  const liveEnden = spieltageRes.spieltage.filter((spieltag) => spieltag.inactive_since === null).map((spieltag) => spieltag.ende);
  const spieltagBound =
    liveBeginne.length === 0
      ? undefined
      : {
          // Lexicographic min/max is date order on YYYY-MM-DD, the comparison every span rule uses.
          startMax: [...liveBeginne].sort()[0] ?? "",
          endMin: [...liveEnden].sort().at(-1) ?? "",
        };

  return (
    // Keyed by the state the drafts mirror — the match editor's reason: the same route pattern reconciles
    // in place, and a saved season must reopen with its saved values.
    <AdminSaisonEditView
      key={JSON.stringify(saison)}
      saison={{
        id: saison.id,
        status: saison.status,
        start_date: saison.start_date,
        end_date: saison.end_date,
        rules: saison.rules,
      }}
      rollover={rollover}
      swap={swap}
      spieltagBound={spieltagBound}
    />
  );
}

/**
 * Whether this fixture is one that happened, as both swap windows ask it (ADR-0062).
 *
 * **The mirror of `fl_backend/app/api/saisons/admin_router.py :: _has_taken_place`, and it has to stay
 * one.** The endpoint refuses on its answer and this page decides what to offer on the same answer, so a
 * clause on one side and not the other either offers a pair the write path 409s or hides a swap that
 * would have worked (ADR-0038).
 *
 * The goal counts are the clause a reader would not predict: `PATCH /spiele/{spiel_id}` derives
 * `ergebnis` from BOTH counts and drops the goals only when a SIDE is absent, so a fixture with two
 * clubs on it and one count entered is stored holding goals and no result. Somebody typed that number
 * about a match that was played.
 *
 * Not built from `computeSpielStatus`: a status label is not a filter and `ausstehend` is not a
 * partition (ADR-0058).
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
