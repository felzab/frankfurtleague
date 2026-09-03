import { Suspense } from "react";
import { connection } from "next/server";

import { AdminCreateSpielortModal } from "@/features/spielorte/components/modals/AdminCreateSpielortModal";
import { AdminSpielorteView } from "@/features/spielorte/components/views/AdminSpielorteView";
import { SPIELORTE_CRUD_COPY } from "@/features/spielorte/constants";
import { getSpielorte } from "@/features/spielorte/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

// Not async, so the chrome never waits on the list: a static heading must not sit behind a
// round-trip.
export default function AdminSpielortePage() {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={SPIELORTE_CRUD_COPY.searchLabel}
          searchPlaceholder={SPIELORTE_CRUD_COPY.searchPlaceholder}
        />
      }
      createModal={<AdminCreateSpielortModal />}>
      <Suspense fallback={<AdminCrudFallback />}>
        <SpielorteTable />
      </Suspense>
    </AdminCrudShell>
  );
}

async function SpielorteTable() {
  await connection();
  // Retired included: this list is the only surface that can bring one back.
  const spielorteRes = await getSpielorte({ include_inactive: true });

  return <AdminSpielorteView spielorte={spielorteRes.spielorte} />;
}
