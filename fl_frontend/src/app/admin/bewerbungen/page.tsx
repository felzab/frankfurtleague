import { Suspense } from "react";
import { connection } from "next/server";

import { AdminBewerbungenView } from "@/features/bewerbungen/components/views/AdminBewerbungenView";
import { BEWERBUNGEN_CRUD_COPY } from "@/features/bewerbungen/constants";
import { getBewerbungen } from "@/features/bewerbungen/queries";
import { buildBewerbungRows } from "@/features/bewerbungen/utils";
import { getAdminSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getTeamMemberships } from "@/features/teams/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { NextPageProps } from "@/shared/types/types";

// Not async, so the chrome never waits on the list: a static heading must not sit behind a
// round-trip. No create control either: no endpoint writes an application.
export default function AdminBewerbungenPage(props: NextPageProps) {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={BEWERBUNGEN_CRUD_COPY.searchLabel}
          searchPlaceholder={BEWERBUNGEN_CRUD_COPY.searchPlaceholder}
        />
      }>
      <Suspense fallback={<AdminCrudFallback />}>
        <BewerbungenTable searchParams={props.searchParams} />
      </Suspense>
    </AdminCrudShell>
  );
}

/**
 * Each row carries whether it is for the SELECTED season, so the facet can be turned off to reach
 * other seasons — the row-flag shape `/admin/teams` uses.
 *
 * No `limit` is passed: the facets narrow only what the endpoint already answered.
 */
async function BewerbungenTable({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  // The image builder reaches no backend, so the fetches below have to be kept out of the build.
  await connection();
  const requestedSaisonId = await resolveSaisonId(searchParams, "admin");

  // Every status: the facet opens the list on the undecided ones, and a decided application stays
  // the record its decision was taken against. The clubs, because a picked one is stored as an id.
  const [bewerbungenRes, teamsRes, saisonsRes] = await Promise.all([getBewerbungen(), getTeamMemberships(), getAdminSaisons()]);

  // Stops where `/admin/teams` stops: falling through to the first season would narrow to one season
  // while the header's selector names another.
  const selectedSaisonId = requestedSaisonId ?? saisonsRes.saisons.find((saison) => saison.status === "active")?.id;

  return <AdminBewerbungenView bewerbungen={buildBewerbungRows(bewerbungenRes.bewerbungen, teamsRes.teams, selectedSaisonId)} />;
}
