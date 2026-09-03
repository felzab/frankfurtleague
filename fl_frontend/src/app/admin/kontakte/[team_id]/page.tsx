import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminKontakteEditView } from "@/features/kontakte/components/views/AdminKontakteEditView";
import { resolveTeamSaisonMembership } from "@/features/kontakte/utils";
import { getAdminSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getTeamMemberships } from "@/features/teams/queries";
import { resolveTeamId } from "@/features/teams/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

import type { TeamSaisonMembership } from "@/features/teams/types";
import type { NextPageProps } from "@/shared/types/types";

/**
 * The contacts editor. One club per URL; WHICH season's three seats it addresses is the sidemenu
 * selector's `?saison_id=`. It resolves nothing itself (`docs/frontend/spec.md :: I22`).
 */
export default function AdminKontakteEditPage(props: NextPageProps<{ team_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <AdminKontakteEditContent
        params={props.params}
        searchParams={props.searchParams}
      />
    </Suspense>
  );
}

async function AdminKontakteEditContent({
  params,
  searchParams,
}: {
  params: NextPageProps<{ team_id: string }>["params"];
  searchParams: NextPageProps["searchParams"];
}) {
  await connection();
  const teamId = await resolveTeamId(params);
  const requestedSaisonId = await resolveSaisonId(searchParams, "admin");

  const [membershipsRes, saisonsRes] = await Promise.all([getTeamMemberships(), getAdminSaisons()]);
  const saisons = saisonsRes.saisons;
  const selectedSaison = requestedSaisonId
    ? saisons.find((saison) => saison.id === requestedSaisonId)
    : saisons.find((saison) => saison.status === "active");
  if (!selectedSaison) {
    notFound();
  }

  const team = membershipsRes.teams.find((candidate) => candidate.id === teamId);
  if (!team) {
    notFound();
  }

  // A club outside the selected season is NOT not-found: the club exists and the URL names it, so the
  // page opens on a membership of `null` and the panel says there is no row to hang seats off.
  const saison: TeamSaisonMembership = resolveTeamSaisonMembership(team.memberships, selectedSaison);

  return (
    // Keyed by the state the draft mirrors (`docs/frontend/spec.md :: The editor's subtree is keyed`).
    <AdminKontakteEditView
      key={JSON.stringify({ team, saison })}
      team={{ id: team.id, name: team.name, shorthand: team.shorthand, inactive_since: team.inactive_since }}
      saison={saison}
    />
  );
}
