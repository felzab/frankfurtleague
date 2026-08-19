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
 * The squad editor. One player per URL; WHICH season's squad row it addresses is the sidemenu
 * selector's `?saison_id=`. It resolves nothing itself — see the match editor.
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

  // One read carries the record and every squad row; the season list answers which season is
  // selected and its state; the team list resolves a `team_id` into the name the picker shows.
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
    erlaubteStufen: orderStufen(selectedSaison.rules.erlaubte_stufen),
    membership:
      membership === null
        ? null
        : {
            team_id: membership.team_id,
            // Normalised to `""`, so the form's controlled input has one shape to hold.
            nummer: membership.nummer ?? "",
            position: membership.position,
            stufe: membership.stufe,
            is_nachgetragen: membership.is_nachgetragen,
            is_captain: membership.is_captain,
            inactive_since: membership.inactive_since,
          },
  };

  // The shirts already worn in each team this season, so the rail can warn about a second wearer.
  // The edited player's own rows are excluded — their own shirt is not held against them.
  const takenNummern = collectTakenSquadNummern({ spieler: membershipsRes.spieler, saisonId: selectedSaison.id, exceptSpielerId: spielerId });

  // The picker offers the selected season's teams only: a transfer is meaningful within it alone.
  const teams: SpielerTeamOption[] = teamsRes.teams
    .filter((team) => team.memberships.some((candidate) => candidate.saison_id === selectedSaison.id))
    .map((team) => ({ teamId: team.id, name: team.name, shorthand: team.shorthand, takenNummern: takenNummern[team.id] ?? [] }));

  return (
    // Keyed by the state the drafts mirror, for the match editor's reason.
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
