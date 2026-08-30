import { Suspense } from "react";
import { connection } from "next/server";

import { getAdminSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { AdminKontakteView } from "@/features/teams/components/views/AdminKontakteView";
import { KONTAKTE_CRUD_COPY } from "@/features/teams/constants";
import { getTeamMemberships } from "@/features/teams/queries";
import { buildKontaktRows } from "@/features/teams/utils";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { NextPageProps } from "@/shared/types/types";

// Not async, so the chrome never waits on the list. No create control at all, since a contact is
// written on the team it belongs to.
export default function AdminKontaktePage(props: NextPageProps) {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={KONTAKTE_CRUD_COPY.searchLabel}
          searchPlaceholder={KONTAKTE_CRUD_COPY.searchPlaceholder}
          // This shell passes no `createModal`, so the bar has no trigger to join: it keeps its own
          // right edge and the row's full width.
          attachEnd={false}
        />
      }>
      <Suspense fallback={<AdminCrudFallback />}>
        <KontakteTable searchParams={props.searchParams} />
      </Suspense>
    </AdminCrudShell>
  );
}

/**
 * Every club's three contacts for the SELECTED season, in one list. Season-scoped because the people
 * are: a school's staff turns over, and a finished season records who was reachable while it ran.
 */
async function KontakteTable({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  // The image builder reaches no backend, so the fetch below has to be kept out of the build.
  await connection();
  const requestedSaisonId = await resolveSaisonId(searchParams, "admin");

  // Not `"use cache"`, a cross-request store keyed on arguments rather than the caller:
  // `fl_frontend/src/features/saisons/queries.ts :: getAdminSaisons`.
  const [membershipsRes, saisonsRes] = await Promise.all([getTeamMemberships(), getAdminSaisons()]);
  // Stops where `/admin/teams` stops: falling through to the first season would list one season while
  // the header's selector names another.
  const selectedSaisonId = requestedSaisonId ?? saisonsRes.saisons.find((saison) => saison.status === "active")?.id;

  const rows = buildKontaktRows(membershipsRes.teams, selectedSaisonId);

  // Plain data, never the facets themselves: a facet carries a `read` function and this is a Server
  // Component. Read from the ROWS rather than from every club, so the filter offers no club whose
  // junction this season has none of.
  const teams = rows.map((row) => ({ teamId: row.teamId, name: row.teamName }));

  return (
    <AdminKontakteView
      kontakte={rows}
      teams={teams}
    />
  );
}
