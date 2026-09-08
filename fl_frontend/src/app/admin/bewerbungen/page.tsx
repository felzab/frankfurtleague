import { Suspense } from "react";
import { connection } from "next/server";

import { AdminBewerbungenView } from "@/features/bewerbungen/components/views/AdminBewerbungenView";
import { BEWERBUNGEN_CRUD_COPY } from "@/features/bewerbungen/constants";
import { getBewerbungenQueue } from "@/features/bewerbungen/queries";
import { buildBewerbungRows } from "@/features/bewerbungen/utils";
import { getAdminSaisons } from "@/features/saisons/queries";
import { resolveSaisonId } from "@/features/saisons/resolvers";
import { getTeamMemberships } from "@/features/teams/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";
import { leserichtungHrefFromRoute, parseLeserichtung, umgekehrt } from "@/shared/utils/leserichtung";

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
 */
async function BewerbungenTable({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const params = (await searchParams) ?? {};
  const requestedSaisonId = await resolveSaisonId(searchParams, "admin");
  const richtung = parseLeserichtung(params);

  const [bewerbungenRes, teamsRes, saisonsRes] = await Promise.all([
    // Narrowed by the status the bar selects rather than after the read, so a decided application
    // stops spending the endpoint's cap while staying one click away. Reversing `order` swaps which
    // end of a flooded queue survives that cap.
    getBewerbungenQueue(params, richtung),
    // The clubs, because a picked one is stored as an id.
    getTeamMemberships(),
    getAdminSaisons(),
  ]);

  // Stops where `/admin/teams` stops: falling through to the first season would narrow to one season
  // while the header's selector names another.
  const selectedSaisonId = requestedSaisonId ?? saisonsRes.saisons.find((saison) => saison.status === "active")?.id;

  return (
    <AdminBewerbungenView
      bewerbungen={buildBewerbungRows(bewerbungenRes.bewerbungen, teamsRes.teams, selectedSaisonId)}
      anzahlJeStatus={bewerbungenRes.anzahl_je_status}
      richtung={richtung}
      unvollstaendig={
        bewerbungenRes.vollstaendig ? null : { richtung: richtung, umkehrHref: leserichtungHrefFromRoute(params, umgekehrt(richtung)) }
      }
    />
  );
}
