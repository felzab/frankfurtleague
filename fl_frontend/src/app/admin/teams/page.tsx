import { Suspense } from "react";
import { connection } from "next/server";

import { getSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { AdminCreateTeamModal } from "@/features/teams/components/modals/AdminCreateTeamModal";
import { AdminTeamsView } from "@/features/teams/components/views/AdminTeamsView";
import { TEAMS_CRUD_COPY } from "@/features/teams/constants";
import { getTeamMemberships } from "@/features/teams/queries";
import { buildGruppeOffer } from "@/features/teams/utils";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { AdminTeamRow, TeamCreateSaisonOption } from "@/features/teams/types";
import type { NextPageProps } from "@/shared/types/types";

// Not async, so the chrome never waits on the team list — the pattern of the two sibling pages.
// The create modal needs the season list (one form creates the club AND enters it into a season),
// so it gets its own boundary instead of making the whole page async. `connection()` sits with each
// fetch it guards — ADR-0009 requires only that nothing fetches at build time.
export default function AdminTeamsPage(props: NextPageProps) {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={TEAMS_CRUD_COPY.searchLabel}
          searchPlaceholder={TEAMS_CRUD_COPY.searchPlaceholder}
        />
      }
      createModal={
        // The fallback holds the trigger's own height (`formButton` trigger: h-12, lg:h-15), so the
        // header row does not jump when the season-loaded modal streams in.
        <Suspense fallback={<div className="h-12 lg:h-15" />}>
          <CreateTeamModalLoader searchParams={props.searchParams} />
        </Suspense>
      }>
      <Suspense fallback={<AdminCrudFallback />}>
        <TeamsTable searchParams={props.searchParams} />
      </Suspense>
    </AdminCrudShell>
  );
}

async function CreateTeamModalLoader({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const requestedSaisonId = await resolveSaisonId(searchParams);
  const [saisonsRes, membershipsRes] = await Promise.all([getSaisons(), getTeamMemberships()]);

  // Only PLANNED seasons are offered (decided 2026-08-07): a team enters a season before it starts.
  // Each carries its groups' fill state, so the form can disable a full group up front.
  const allMemberships = membershipsRes.teams.map((team) => team.memberships);
  const saisonOptions: TeamCreateSaisonOption[] = saisonsRes.saisons
    .filter((saison) => saison.status === "future")
    .map((saison) => ({ saisonId: saison.id, offer: buildGruppeOffer(saison.id, saison.rules, allMemberships) }));

  // The viewed season when it is planned — at rollover time that is where a new club belongs —
  // else the first planned one.
  const defaultSaisonId = saisonOptions.find((option) => option.saisonId === requestedSaisonId)?.saisonId ?? saisonOptions[0]?.saisonId ?? null;

  return (
    <AdminCreateTeamModal
      saisonOptions={saisonOptions}
      defaultSaisonId={defaultSaisonId}
    />
  );
}

/**
 * EVERY team across every season, each row carrying the SELECTED season's junction data (decided
 * 2026-08-07). One read: `GET /teams/memberships` answers the club-centric question the
 * season-scoped reads cannot, and `getSaisons` supplies the statuses the retire guard and the
 * status column need. A team in no season at all is listed too, with nothing season-scoped to show.
 */
async function TeamsTable({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const requestedSaisonId = await resolveSaisonId(searchParams);

  const [membershipsRes, saisonsRes] = await Promise.all([getTeamMemberships(), getSaisons()]);
  const saisons = saisonsRes.saisons;
  const selectedSaisonId = requestedSaisonId ?? saisons.find((saison) => saison.status === "active")?.id;
  const selectedSaisonStatus = saisons.find((saison) => saison.id === selectedSaisonId)?.status ?? "active";
  const statusBySaisonId = new Map(saisons.map((saison) => [saison.id, saison.status]));

  const rows: AdminTeamRow[] = membershipsRes.teams.map((team) => {
    const selected = team.memberships.find((membership) => membership.saison_id === selectedSaisonId) ?? null;
    return {
      id: team.id,
      name: team.name,
      full_name: team.full_name,
      shorthand: team.shorthand,
      inactive_since: team.inactive_since,
      selected: selected === null ? null : { gruppe: selected.gruppe, disqualifikation: selected.disqualifikation },
      // Mirrors the write path's own refusal (REQ-RETIRE-001): retiring is offered only while no
      // running or planned season holds the team.
      isRetireable: !team.memberships.some((membership) => {
        const status = statusBySaisonId.get(membership.saison_id);
        return status === "active" || status === "future";
      }),
    };
  });

  return (
    <AdminTeamsView
      teams={rows}
      selectedSaisonStatus={selectedSaisonStatus}
    />
  );
}
