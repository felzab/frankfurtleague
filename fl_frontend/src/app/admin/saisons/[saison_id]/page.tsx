import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminSaisonEditView } from "@/features/saisons/components/views/AdminSaisonEditView";
import { getSaisons } from "@/features/saisons/queries";
import { resolveSaisonIdParam } from "@/features/saisons/resolvers";
import { buildGruppenSwapContext, buildSpieltagBound, holdsDrawnSpiele } from "@/features/saisons/utils";
import { getSpiele } from "@/features/spiele/queries";
import { getSpieltage } from "@/features/spieltage/queries";
import { getTeams } from "@/features/teams/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { PLACEHOLDER } from "@/shared/utils/format";

import type { SaisonGruppenSwapContext, SaisonOffeneSpiel, SaisonRolloverContext, SaisonSpielplanContext } from "@/features/saisons/types";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The season editor. The season is the SEGMENT, not the selector's `?saison_id=`: the club and
 * player editors address a junction row, while this page's subject IS a season. It resolves
 * nothing itself — see the match editor.
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

  // The whole list, not `GET /saisons/{id}`: the rollover panel also needs whichever season holds
  // `active`, which a read by id cannot name.
  const saisonsRes = await getSaisons();
  const saison = saisonsRes.saisons.find((candidate) => candidate.id === saisonId);
  if (!saison) {
    notFound();
  }

  const outgoing = saisonsRes.saisons.find((candidate) => candidate.status === "active") ?? null;
  const outgoingSaisonId = outgoing === null || outgoing.id === saison.id ? null : outgoing.id;

  // The argument matches the one `/admin/saisons` warms, so both pages share a `"use cache"` entry.
  const [spieltageRes, outgoingSpieleRes, teamsRes, playoffSpieleRes, gruppenSpieleRes] = await Promise.all([
    getSpieltage({ saison_id: saison.id }),
    // Only where there is something to warn about: only a `future` season has a rollover to present —
    // the running one has nothing to switch to, a `past` one is refused (`REQ-ACTIVATE-002`) — and no
    // incumbent means no outgoing fixtures.
    outgoingSaisonId === null || saison.status !== "future" ? Promise.resolve(null) : getSpiele({ saison_id: outgoingSaisonId }),
    // `include_inactive` because an admin picker hiding a retired club that still holds a junction
    // row would make a swap the endpoint accepts look impossible.
    getTeams({ saison_id: saison.id, include_inactive: true }),
    // `playoffs` is exactly the set `REQ-SWAP-002` counts, so the page asks the endpoint's own
    // question rather than filtering a whole season here.
    getSpiele({ saison_id: saison.id, saison_phase: "playoffs" }),
    // The other half of the same question (`REQ-SWAP-004`), narrowed to the phase the rule asks about.
    getSpiele({ saison_id: saison.id, saison_phase: "gruppenphase" }),
  ]);

  /**
   * Listed so `REQ-ACTIVATE-001` blocks actionably rather than as a 409, which means "unfinished"
   * must keep mirroring `unplayed_spiel_nrs`: too narrow offers a rollover that always fails, too
   * wide blocks one that would work.
   */
  const offeneSpiele: SaisonOffeneSpiel[] = (outgoingSpieleRes?.spiele ?? [])
    .filter((spiel) => spiel.ergebnis === null && spiel.sonderereignis !== "ausgefallen" && spiel.sonderereignis !== "annulliert")
    .map((spiel) => ({
      id: spiel.id,
      spielNr: spiel.spiel_nr,
      datum: spiel.datum,
      // An unfilled knockout slot is a normal state, so the shared placeholder stands in. The
      // provenance label belongs on the fixture's own page.
      paarung: `${spiel.team1?.name ?? PLACEHOLDER.slot} gegen ${spiel.team2?.name ?? PLACEHOLDER.slot}`,
    }))
    .sort((left, right) => left.spielNr - right.spielNr);

  const rollover: SaisonRolloverContext = { outgoingSaisonId, offeneSpiele };

  // The condition `REQ-SPIELPLAN-001`, `REQ-ACTIVATE-003` and `REQ-RULES-011` each read, derived off
  // the two fixture reads the swap already needs.
  const hasDrawnSpiele = holdsDrawnSpiele({ gruppenSpiele: gruppenSpieleRes.spiele, playoffSpiele: playoffSpieleRes.spiele });

  /**
   * The generator's own preconditions, off reads this page already makes: the watermark rides on the
   * season, and `REQ-SPIELPLAN-002` counts exactly the rows `getSpieltage` lists for it.
   */
  const spielplan: SaisonSpielplanContext = {
    spielplan: saison.spielplan,
    spieltageCount: spieltageRes.spieltage.length,
    schedule: saison.schedule,
  };

  /**
   * Assembled by the derivation both entry points share, so this page and the club editor grade a
   * swap pair identically.
   */
  const swap: SaisonGruppenSwapContext = buildGruppenSwapContext({
    teams: teamsRes.format === "list" ? teamsRes.teams : [],
    gruppenSpiele: gruppenSpieleRes.spiele,
    playoffSpiele: playoffSpieleRes.spiele,
  });

  // The inner bound on the season's dates (`REQ-DATE-004`), derived rather than assembled here: a
  // drawn season's matchdays are undated, which is the case the derivation is tested on.
  const spieltagBound = buildSpieltagBound(spieltageRes.spieltage);

  return (
    // Keyed by the state the drafts mirror, for the match editor's reason.
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
      spielplan={spielplan}
      hasDrawnSpiele={hasDrawnSpiele}
      spieltagBound={spieltagBound}
    />
  );
}
