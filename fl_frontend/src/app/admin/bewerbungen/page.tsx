import { Suspense } from "react";
import { connection } from "next/server";

import { AdminBewerbungenView } from "@/features/bewerbungen/components/views/AdminBewerbungenView";
import { BEWERBUNGEN_CRUD_COPY } from "@/features/bewerbungen/constants";
import { getBewerbungenQueue } from "@/features/bewerbungen/queries";
import { buildBewerbungRows } from "@/features/bewerbungen/utils";
import { resolveAdminSaison } from "@/features/saisons/resolvers";
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
          // This shell passes no `createModal`, so the bar has no trigger to join: it keeps its own
          // right edge and the row's full width.
          attachEnd={false}
        />
      }>
      <Suspense fallback={<AdminCrudFallback shape="cards" />}>
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
  const richtung = parseLeserichtung(params);

  const [teamsRes, selectedSaison] = await Promise.all([
    // The clubs, because a picked one is stored as an id.
    getTeamMemberships(),
    resolveAdminSaison(searchParams),
  ]);
  const selectedSaisonId = selectedSaison?.id;

  // After the season rather than beside it: the bar's season facet narrows the READ, so the request
  // cannot be composed before the season it is relative to is known.
  const bewerbungenRes = await getBewerbungenQueue(params, richtung, selectedSaisonId);

  return (
    <AdminBewerbungenView
      bewerbungen={buildBewerbungRows(bewerbungenRes.bewerbungen, teamsRes.teams, selectedSaisonId)}
      anzahlJeStatus={bewerbungenRes.anzahl_je_status}
      anzahlJeSaisonbezug={bewerbungenRes.anzahl_je_saisonbezug}
      dublettenSchluessel={bewerbungenRes.dubletten_schluessel}
      richtung={richtung}
      unvollstaendig={
        bewerbungenRes.vollstaendig ? null : { richtung: richtung, umkehrHref: leserichtungHrefFromRoute(params, umgekehrt(richtung)) }
      }
    />
  );
}
