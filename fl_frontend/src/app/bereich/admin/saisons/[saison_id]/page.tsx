import { Suspense } from "react";
import { notFound } from "next/navigation";

import { buildReplacementContext } from "@/features/saisons/components/forms/AdminSaisonEditForm/replacementOffer";
import { AdminSaisonEditView } from "@/features/saisons/components/views/AdminSaisonEditView";
import { getAdminSaisons, getLoeschungVorschau } from "@/features/saisons/queries";
import { resolveSaisonIdParam } from "@/features/saisons/resolvers";
import {
  buildGruppenSwapContext,
  buildSpielplanBestand,
  buildSpieltagBound,
  holdsDrawnSpiele,
  holdsUndatierteSpieltage,
} from "@/features/saisons/utils";
import { getSpielberichteZustaende } from "@/features/spielberichte/queries";
import { getAdminSpiele } from "@/features/spiele/queries";
import { getAdminSpieltage } from "@/features/spieltage/queries";
import { getAdminTeams, getTeamMemberships } from "@/features/teams/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { nullUnlessContractBreak } from "@/shared/utils/degradedRead";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import type { FLLoeschungVorschauResponse } from "@/core/generated/client/types";
import type { SaisonGruppenSwapContext, SaisonOffeneSpiel, SaisonRolloverContext, SaisonSpielplanContext } from "@/features/saisons/types";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The season editor. The season is the SEGMENT, not the selector's `?saison_id=`: the club and
 * player editors address a junction row, while this page's subject IS a season. It resolves
 * nothing itself.
 */
export default function AdminSaisonEditPage(props: NextPageProps<{ saison_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <AdminSaisonEditContent params={props.params} />
    </Suspense>
  );
}

/** The rollover panel's count: none without a season the activation closes, and the failed read said as such. */
function loeschungsVorschau(gelesen: FLLoeschungVorschauResponse | "unlesbar" | null): SaisonRolloverContext["loeschung"] {
  if (gelesen === null || gelesen === "unlesbar") return gelesen;
  if (gelesen.abgeschlossene_saison_id === null) return null;

  return {
    abgeschlosseneSaisonId: gelesen.abgeschlossene_saison_id,
    spieler: gelesen.spieler,
  };
}

async function AdminSaisonEditContent({ params }: { params: NextPageProps<{ saison_id: string }>["params"] }) {
  const saisonId = await resolveSaisonIdParam(params);

  // The whole list, not `GET /saisons/{id}`: the rollover panel also needs whichever season holds
  // `active`, which a read by id cannot name.
  const saisonsRes = await getAdminSaisons();
  const saison = saisonsRes.saisons.find((candidate) => candidate.id === saisonId);
  if (!saison) {
    notFound();
  }

  const outgoing = saisonsRes.saisons.find((candidate) => candidate.status === "active") ?? null;
  const outgoingSaisonId = outgoing === null || outgoing.id === saison.id ? null : outgoing.id;

  // Only a `future` season has a rollover to present — the running one has nothing to switch to, a
  // `past` one is refused (`saison_past`) — and no incumbent means no outgoing fixtures and no
  // season the activation closes.
  const presentsRollover = outgoingSaisonId !== null && saison.status === "future";

  const [spieltageRes, outgoingSpieleRes, loeschungRes, teamsRes, playoffSpieleRes, gruppenSpieleRes, ligaTeamsRes, berichteRes] =
    await Promise.all([
      getAdminSpieltage({ saison_id: saison.id }),
      presentsRollover ? getAdminSpiele({ saison_id: outgoingSaisonId }) : Promise.resolve(null),
      // Degraded rather than awaited whole: a count the press does not need takes down no page it is pressed from.
      presentsRollover
        ? runWithIncomingTrace(() =>
            getLoeschungVorschau(saison.id).catch((error: unknown) => nullUnlessContractBreak(error) ?? ("unlesbar" as const)),
          )
        : Promise.resolve(null),
      // `include_inactive` because an admin picker hiding a retired club that still holds a junction
      // row would make a swap the endpoint accepts look impossible.
      getAdminTeams({ saison_id: saison.id, include_inactive: true }),
      // `playoffs` is exactly the set `swap_saison_started` counts, so the page asks the endpoint's own
      // question rather than filtering a whole season here.
      getAdminSpiele({ saison_id: saison.id, saison_phase: "playoffs" }),
      // The other half of the same question (`REQ-SWAP-004`), narrowed to the phase the rule asks about.
      getAdminSpiele({ saison_id: saison.id, saison_phase: "gruppenphase" }),
      // The league-wide read, for the replacement's incoming side alone: a club arriving into this
      // season is by definition in none of its reads. Skipped where `saison_past` closes the panel.
      saison.status === "past" ? Promise.resolve(null) : getTeamMemberships(),
      // The reports `spielplan_berichte_eingereicht` counts, for the planned season alone: any other closes both controls already.
      // Degraded, as an unread count closes nothing and the press meets the refusal's own sentence.
      saison.status === "future"
        ? runWithIncomingTrace(() => getSpielberichteZustaende({ saison_id: saison.id }).catch(nullUnlessContractBreak))
        : Promise.resolve(null),
    ]);

  /**
   * Listed so `activate_saison_unfinished` blocks actionably rather than as a 409, which means "unfinished"
   * must keep mirroring `unplayed_spiel_nrs`: too narrow offers a rollover that always fails, too
   * wide blocks one that would work.
   */
  const offeneSpiele: SaisonOffeneSpiel[] = (outgoingSpieleRes?.spiele ?? [])
    .filter((spiel) => spiel.ergebnis === null && spiel.sonderereignis !== "ausgefallen" && spiel.sonderereignis !== "annulliert")
    .map((spiel) => ({
      id: spiel.id,
      spielNr: spiel.spiel_nr,
      datum: spiel.datum,
      // An unfilled knockout slot is a normal state, so the panel's placeholder stands in. The
      // provenance label belongs on the fixture's own page.
      paarung: { team1: spiel.team1?.name ?? null, team2: spiel.team2?.name ?? null },
    }))
    .sort((left, right) => left.spielNr - right.spielNr);

  const rollover: SaisonRolloverContext = {
    outgoingSaisonId,
    offeneSpiele,
    hasUndatierteSpieltage: holdsUndatierteSpieltage(spieltageRes.spieltage),
    loeschung: loeschungsVorschau(loeschungRes),
  };

  // The condition `spielplan_already_drawn`, `activate_target_undrawn` and `rules_shape_after_spielplan` each read, derived off
  // the two fixture reads the swap already needs.
  const hasDrawnSpiele = holdsDrawnSpiele({ gruppenSpiele: gruppenSpieleRes.spiele, playoffSpiele: playoffSpieleRes.spiele });

  /**
   * The generator's own preconditions, off reads this page already makes: the watermark rides on the
   * season, and `spielplan_spieltage_held` counts exactly the rows `getAdminSpieltage` lists for it.
   */
  const spielplan: SaisonSpielplanContext = {
    spielplan: saison.spielplan,
    spieltageCount: spieltageRes.spieltage.length,
    schedule: saison.schedule,
    // Its `erfasst` half must keep mirroring `holds_a_recorded_fact`: too wide closes a replace
    // `spielplan_replace_outside_its_window` allows, too narrow offers one it refuses.
    bestand: buildSpielplanBestand({ gruppenSpiele: gruppenSpieleRes.spiele, playoffSpiele: playoffSpieleRes.spiele }),
    eingereichteBerichte: berichteRes?.spielberichte.length ?? 0,
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

  /**
   * Its rows are NOT `swap.teams`: a junction row whose club is gone reaches no club read, and
   * handing exactly such a row on is what the operation is for — so the fixtures supply it.
   */
  const ersatz = buildReplacementContext({
    saisonId: saison.id,
    teams: teamsRes.format === "list" ? teamsRes.teams : [],
    ligaTeams: ligaTeamsRes?.teams ?? [],
    gruppenSpiele: gruppenSpieleRes.spiele,
    playoffSpiele: playoffSpieleRes.spiele,
  });

  // The inner bound on the season's dates (`saison_span_below_spieltage`), derived rather than assembled here: a
  // drawn season's matchdays are undated, which is the case the derivation is tested on.
  const spieltagBound = buildSpieltagBound(spieltageRes.spieltage);

  return (
    // Unkeyed: the view keys what it holds itself, and a key here would reset the redraw's typing over a save.
    <AdminSaisonEditView
      saison={{
        id: saison.id,
        status: saison.status,
        start_date: saison.start_date,
        end_date: saison.end_date,
        rules: saison.rules,
        bewerbung: saison.bewerbung,
        registrierung: saison.registrierung,
      }}
      rollover={rollover}
      swap={swap}
      ersatz={ersatz}
      spielplan={spielplan}
      hasDrawnSpiele={hasDrawnSpiele}
      spieltagBound={spieltagBound}
    />
  );
}
