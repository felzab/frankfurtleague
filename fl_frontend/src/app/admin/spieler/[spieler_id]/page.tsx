import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { AdminSpielerEditView } from "@/features/spieler/components/views/AdminSpielerEditView";
import { orderStufen } from "@/features/spieler/constants";
import { getSpielerMemberships } from "@/features/spieler/queries";
import { resolveSpielerId } from "@/features/spieler/resolvers";
import { collectTakenSquadNummern } from "@/features/spieler/utils";
import { getTeamMemberships } from "@/features/teams/queries";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

import type { SpielerSaisonMembership, SpielerTeamOption } from "@/features/spieler/types";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The squad editor (ADR-0040). One player per URL; WHICH season's squad row the editor addresses
 * is the sidemenu selector's `?saison_id=` — switching the selector switches what the Kader panel
 * shows and writes, exactly as it does on the club editor.
 *
 * No `generateMetadata` and no `generateStaticParams`, for the reasons the match editor records.
 * **The page itself resolves NOTHING** — every await happens inside the `Suspense` boundary, which
 * is what keeps a fallback-params route renderable (the match editor documents the crash).
 */
export default function AdminSpielerEditPage(props: NextPageProps<{ spieler_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <AdminSpielerEditContent
        params={props.params}
        searchParams={props.searchParams}
      />
    </Suspense>
  );
}

async function AdminSpielerEditContent({
  params,
  searchParams,
}: {
  params: NextPageProps<{ spieler_id: string }>["params"];
  searchParams: NextPageProps["searchParams"];
}) {
  await connection();
  const spielerId = await resolveSpielerId(params);
  const requestedSaisonId = await resolveSaisonId(searchParams);

  // One read carries the player's record and every squad row; the season list answers which season
  // is selected (the current one when the URL names none, ADR-0002) and what state it is in; the
  // team list resolves a `team_id` into the name the picker shows.
  const [membershipsRes, saisonsRes, teamsRes] = await Promise.all([getSpielerMemberships(), getSaisons(), getTeamMemberships()]);
  const saisons = saisonsRes.saisons;
  const selectedSaison = requestedSaisonId
    ? saisons.find((saison) => saison.id === requestedSaisonId)
    : saisons.find((saison) => saison.status === "active");
  if (!selectedSaison) {
    notFound();
  }

  const spieler = membershipsRes.spieler.find((candidate) => candidate.id === spielerId);
  if (!spieler) {
    notFound();
  }

  const membership = spieler.memberships.find((candidate) => candidate.saison_id === selectedSaison.id) ?? null;

  const saison: SpielerSaisonMembership = {
    saisonId: selectedSaison.id,
    saisonStatus: selectedSaison.status,
    // The season's own list, in the league's order — what the Stufe picker offers.
    erlaubteStufen: orderStufen(selectedSaison.rules.erlaubte_stufen),
    membership:
      membership === null
        ? null
        : {
            team_id: membership.team_id,
            // Normalised to `""` here, so the form's controlled input has one shape to hold.
            nummer: membership.nummer ?? "",
            position: membership.position,
            stufe: membership.stufe,
            is_nachgetragen: membership.is_nachgetragen,
            is_captain: membership.is_captain,
            inactive_since: membership.inactive_since,
          },
  };

  // Which shirts are already worn in each team this season, so the editor's rail can warn that a save
  // would put a second wearer on one. The edited player's own rows are excluded: the shirt they are
  // standing in is not one somebody else holds against them.
  const takenNummern = collectTakenSquadNummern({ spieler: membershipsRes.spieler, saisonId: selectedSaison.id, exceptSpielerId: spielerId });

  // What the team picker may offer: the selected season's own teams. A transfer is only meaningful
  // within the season the squad row belongs to.
  const teams: SpielerTeamOption[] = teamsRes.teams
    .filter((team) => team.memberships.some((candidate) => candidate.saison_id === selectedSaison.id))
    .map((team) => ({ teamId: team.id, name: team.name, shorthand: team.shorthand, takenNummern: takenNummern[team.id] ?? [] }));

  return (
    // Keyed by the state the drafts mirror — the match editor's reason: the same route pattern
    // reconciles in place, and a saved player must reopen with their saved values.
    <AdminSpielerEditView
      key={JSON.stringify({ spieler, saison })}
      spieler={{
        id: spieler.id,
        vorname: spieler.vorname,
        nachname: spieler.nachname,
        inactive_since: spieler.inactive_since,
      }}
      saison={saison}
      teams={teams}
    />
  );
}
