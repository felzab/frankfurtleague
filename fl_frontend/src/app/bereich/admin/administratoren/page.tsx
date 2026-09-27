import { Suspense } from "react";
import { connection } from "next/server";

import { getAdminSession } from "@/core/auth";
import { verwaltungOf } from "@/core/verwaltung";
import { AdminCreateBerechtigungModal } from "@/features/berechtigungen/components/modals/AdminCreateBerechtigungModal";
import { AdminBerechtigungenView } from "@/features/berechtigungen/components/views/AdminBerechtigungenView";
import { BERECHTIGUNGEN_CRUD_COPY } from "@/features/berechtigungen/constants";
import { getBerechtigungen } from "@/features/berechtigungen/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

// Not async, so the chrome never waits on the list.
export default function AdminAdministratorenPage() {
  return (
    <AdminCrudShell
      // The box takes an address, and this segment is dynamic: a `?q=` here is a request line nginx logs.
      privateQuery
      search={
        <AdminCrudSearch
          searchLabel={BERECHTIGUNGEN_CRUD_COPY.searchLabel}
          searchPlaceholder={BERECHTIGUNGEN_CRUD_COPY.searchPlaceholder}
        />
      }
      createModal={<AdminCreateBerechtigungModal />}>
      <Suspense
        fallback={
          <AdminCrudFallback
            shape="cards"
            hasFacets={false}
          />
        }>
        <Berechtigungen />
      </Suspense>
    </AdminCrudShell>
  );
}

/** Every grant, over every season: access to the administration is no season's. */
async function Berechtigungen() {
  await connection();

  const [berechtigungenRes, darfEntziehen] = await Promise.all([getBerechtigungen(), darfEntziehenOf()]);

  return (
    <AdminBerechtigungenView
      berechtigungen={berechtigungenRes.berechtigungen}
      uebersprungen={berechtigungenRes.uebersprungen}
      darfEntziehen={darfEntziehen}
    />
  );
}

/**
 * Whether the signed-in administrator may revoke, which only an `owner` grant may: off the lookup the guard's own
 * verdict was read from, memoised per render, so it costs no second read.
 */
async function darfEntziehenOf(): Promise<boolean> {
  const served = await getAdminSession();

  return served !== null && (await verwaltungOf(served.user.email)) === "owner";
}
