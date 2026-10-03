import { Suspense } from "react";
import { connection } from "next/server";

import { AdminCreateSaisonModal } from "@/features/saisons/components/modals/AdminCreateSaisonModal";
import { AdminSaisonsView } from "@/features/saisons/components/views/AdminSaisonsView";
import { SAISONS_CRUD_COPY } from "@/features/saisons/constants";
import { getAdminSaisons } from "@/features/saisons/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { AdminSaisonRow } from "@/features/saisons/types";

// Not async, so the chrome never waits on the list. The create trigger fetches nothing, so unlike
// the club and player pages it has no boundary of its own.
export default function AdminSaisonsPage() {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={SAISONS_CRUD_COPY.searchLabel}
          searchPlaceholder={SAISONS_CRUD_COPY.searchPlaceholder}
        />
      }
      createModal={<AdminCreateSaisonModal />}>
      <Suspense fallback={<AdminCrudFallback hasFacets={false} />}>
        <SaisonsTable />
      </Suspense>
    </AdminCrudShell>
  );
}

/** EVERY season, narrowed by nothing. */
async function SaisonsTable() {
  await connection();

  const saisonsRes = await getAdminSaisons();

  const rows: AdminSaisonRow[] = saisonsRes.saisons.map((saison) => ({
    id: saison.id,
    start_date: saison.start_date,
    end_date: saison.end_date,
    status: saison.status,
    rules: saison.rules,
  }));

  return <AdminSaisonsView saisons={rows} />;
}
