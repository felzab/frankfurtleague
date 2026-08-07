import { Suspense } from "react";
import { connection } from "next/server";

import { getCurrentSaison, getSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { AdminCreateTeamModal } from "@/features/teams/components/modals/AdminCreateTeamModal";
import { AdminTeamsView } from "@/features/teams/components/views/AdminTeamsView";
import { getTeams } from "@/features/teams/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { NextPageProps } from "@/shared/types/types";

// Not async, so the chrome never waits on the team list — the pattern of the two sibling pages.
// The list follows the sidemenu selector's season (owner, 2026-08-07): `?saison_id=` narrows every
// read here exactly as it narrows the public pages, and an absent parameter is the backend's own
// current-season default (ADR-0002). The create modal needs the season list (one form creates the
// club AND enters it into a season), so it gets its own boundary instead of making the whole page
// async. `connection()` sits with each fetch it guards — ADR-0009 requires only that nothing
// fetches at build time.
export default function AdminTeamsPage(props: NextPageProps) {
  return (
    <AdminCrudShell
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
  const [saisonsRes, currentSaisonRes] = await Promise.all([getSaisons(), getCurrentSaison()]);

  return (
    <AdminCreateTeamModal
      saisons={saisonsRes.saisons}
      // The create defaults to the season being VIEWED — at rollover time that is the future season
      // the admin has just switched to, which is exactly where a new club belongs.
      currentSaisonId={requestedSaisonId ?? currentSaisonRes.saison.id}
    />
  );
}

async function TeamsTable({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const requestedSaisonId = await resolveSaisonId(searchParams);

  // The SELECTED season's clubs — every team read is season-scoped with a strict junction join
  // (I11), so this list is "who is in the season", not "every club ever". `include_inactive`
  // because a retired club holding its shorthand is what explains a 409 from the create form, and
  // the reactivate control lives on its row (ADR-0032).
  const teamsRes = await getTeams({ saison_id: requestedSaisonId, include_inactive: true });
  if (teamsRes.format !== "list") {
    throw new Error("Expected a list, got something else");
  }

  return <AdminTeamsView teams={teamsRes.teams} />;
}
