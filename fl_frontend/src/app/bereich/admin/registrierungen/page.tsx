import { Suspense } from "react";
import { connection } from "next/server";

import { AdminRegistrierungenView } from "@/features/registrierungen/components/views/AdminRegistrierungenView";
import { REGISTRIERUNGEN_CRUD_COPY } from "@/features/registrierungen/constants";
import { getAdminRegistrierungen } from "@/features/registrierungen/queries";
import { buildAdminRegistrierungRows } from "@/features/registrierungen/utils";
import { getTeamMemberships } from "@/features/teams/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";
import { leserichtungHrefFromRoute, parseLeserichtung, umgekehrt } from "@/shared/utils/leserichtung";

import type { NextPageProps } from "@/shared/types/types";

// Not async, so the chrome never waits on the list. No write at all: a registration is decided by its
// team, and what an administrator cures is on the contacts and season editors each row links to.
export default function AdminRegistrierungenPage(props: NextPageProps) {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={REGISTRIERUNGEN_CRUD_COPY.searchLabel}
          searchPlaceholder={REGISTRIERUNGEN_CRUD_COPY.searchPlaceholder}
          // This shell passes no `createModal`, so the bar has no trigger to join: it keeps its own
          // right edge and the row's full width.
          attachEnd={false}
        />
      }>
      <Suspense
        fallback={
          <AdminCrudFallback
            shape="cards"
            hasFacets={false}
          />
        }>
        <Registrierungen searchParams={props.searchParams} />
      </Suspense>
    </AdminCrudShell>
  );
}

/** Every season's pending registrations, so the header's season selector narrows nothing here. */
async function Registrierungen({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const params = (await searchParams) ?? {};
  const richtung = parseLeserichtung(params);

  // The clubs for their names alone, a registration storing its team as an id.
  const [teamsRes, registrierungenRes] = await Promise.all([getTeamMemberships(), getAdminRegistrierungen(richtung)]);

  return (
    <AdminRegistrierungenView
      registrierungen={buildAdminRegistrierungRows(registrierungenRes.registrierungen, teamsRes.teams)}
      unvollstaendig={
        registrierungenRes.vollstaendig ? null : { richtung: richtung, umkehrHref: leserichtungHrefFromRoute(params, umgekehrt(richtung)) }
      }
    />
  );
}
