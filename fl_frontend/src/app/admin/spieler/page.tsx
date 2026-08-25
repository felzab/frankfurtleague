import { Suspense } from "react";
import { connection } from "next/server";

import { getAdminSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { AdminCreateSpielerModal } from "@/features/spieler/components/modals/AdminCreateSpielerModal";
import { AdminSpielerView } from "@/features/spieler/components/views/AdminSpielerView";
import { orderStufen, SPIELER_CRUD_COPY } from "@/features/spieler/constants";
import { getSpielerMemberships } from "@/features/spieler/queries";
import { collectTakenSquadNummern } from "@/features/spieler/utils";
import { getTeamMemberships } from "@/features/teams/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { AdminSpielerRow, SpielerCreateSaisonOption, SpielerTeamOption } from "@/features/spieler/types";
import type { FLTeamWithMemberships } from "@/features/teams/schemas";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The teams entered in one season. `takenByTeam` carries the shirts already worn in each, so the
 * create form can warn about a second wearer — a state the API permits and never refuses.
 */
function teamsInSaison(teams: FLTeamWithMemberships[], saisonId: string, takenByTeam: Record<string, string[]>): SpielerTeamOption[] {
  return teams
    .filter((team) => team.memberships.some((membership) => membership.saison_id === saisonId))
    .map((team) => ({ teamId: team.id, name: team.name, shorthand: team.shorthand, takenNummern: takenByTeam[team.id] ?? [] }));
}

// Not async, so the chrome never waits on the list. The create modal needs the season and team
// lists, so it gets its own boundary.
export default function AdminSpielerPage(props: NextPageProps) {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={SPIELER_CRUD_COPY.searchLabel}
          searchPlaceholder={SPIELER_CRUD_COPY.searchPlaceholder}
        />
      }
      createModal={
        // The fallback holds the trigger's own height, so the header row does not jump.
        <Suspense fallback={<div className="h-12 lg:h-15" />}>
          <CreateSpielerModalLoader searchParams={props.searchParams} />
        </Suspense>
      }>
      <Suspense fallback={<AdminCrudFallback />}>
        <SpielerTable searchParams={props.searchParams} />
      </Suspense>
    </AdminCrudShell>
  );
}

async function CreateSpielerModalLoader({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const requestedSaisonId = await resolveSaisonId(searchParams, "admin");
  // Repeating the table's read costs nothing: React's `cache` shares one round trip per render pass.
  // Not `"use cache"`, a cross-request store keyed on arguments rather than the caller:
  // `fl_frontend/src/features/saisons/queries.ts :: getAdminSaisons`.
  const [saisonsRes, teamsRes, spielerRes] = await Promise.all([getAdminSaisons(), getTeamMemberships(), getSpielerMemberships()]);

  // Running and planned both, unlike the club create's planned-only rule: a squad is filled in
  // during its season.
  const saisonOptions: SpielerCreateSaisonOption[] = saisonsRes.saisons
    .filter((saison) => saison.status === "active" || saison.status === "future")
    .map((saison) => ({
      saisonId: saison.id,
      isNachgetragen: saison.status === "active",
      // No player to exclude: the create form's subject does not exist yet, so every live row counts.
      teams: teamsInSaison(
        teamsRes.teams,
        saison.id,
        collectTakenSquadNummern({ spieler: spielerRes.spieler, saisonId: saison.id, exceptSpielerId: "" }),
      ),
      // Ordered by the league's (`orderStufen`), so two seasons never present a different sequence.
      erlaubteStufen: orderStufen(saison.rules.erlaubte_stufen),
    }));

  // The viewed season when it takes players, else the first that does.
  const defaultSaisonId = saisonOptions.find((option) => option.saisonId === requestedSaisonId)?.saisonId ?? saisonOptions[0]?.saisonId ?? null;

  return (
    <AdminCreateSpielerModal
      saisonOptions={saisonOptions}
      defaultSaisonId={defaultSaisonId}
    />
  );
}

/**
 * EVERY player across every season, each row carrying the SELECTED season's squad row — the
 * player-centric question the season-scoped reads cannot answer. A player in no squad is listed too.
 */
async function SpielerTable({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const requestedSaisonId = await resolveSaisonId(searchParams, "admin");

  const [membershipsRes, saisonsRes, teamsRes] = await Promise.all([getSpielerMemberships(), getAdminSaisons(), getTeamMemberships()]);
  const saisons = saisonsRes.saisons;
  const activeSaisonId = saisons.find((saison) => saison.status === "active")?.id;
  const selectedSaisonId = requestedSaisonId ?? activeSaisonId ?? saisons[0]?.id ?? "";
  const selectedSaisonStatus = saisons.find((saison) => saison.id === selectedSaisonId)?.status ?? "active";

  const teamById = new Map(teamsRes.teams.map((team) => [team.id, team]));

  const rows: AdminSpielerRow[] = membershipsRes.spieler.map((spieler) => {
    const selected = spieler.memberships.find((membership) => membership.saison_id === selectedSaisonId) ?? null;
    const team = selected === null ? undefined : teamById.get(selected.team_id);

    return {
      id: spieler.id,
      vorname: spieler.vorname,
      nachname: spieler.nachname,
      fullName: spieler.nachname === null ? spieler.vorname : `${spieler.vorname} ${spieler.nachname}`,
      inactive_since: spieler.inactive_since,
      selected:
        selected === null
          ? null
          : {
              team_id: selected.team_id,
              // Normalised to `""` here, so the controlled input and the list's truthiness check read one shape.
              nummer: selected.nummer ?? "",
              position: selected.position,
              stufe: selected.stufe,
              is_nachgetragen: selected.is_nachgetragen,
              is_captain: selected.is_captain,
              inactive_since: selected.inactive_since,
              // An unresolvable team is a squad row pointing at a deleted club: null, not a crash, so the row
              // still lists and the state is visible.
              teamName: team?.name ?? null,
              teamShorthand: team?.shorthand ?? null,
            },
    };
  });

  return (
    <AdminSpielerView
      spieler={rows}
      // The create modal's list, for the facet's options: a filter naming another season's club would
      // narrow to nothing.
      teams={teamsInSaison(teamsRes.teams, selectedSaisonId, {})}
      selectedSaisonId={selectedSaisonId}
      selectedSaisonStatus={selectedSaisonStatus}
    />
  );
}
