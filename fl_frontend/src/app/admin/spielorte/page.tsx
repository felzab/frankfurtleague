import { Suspense } from "react";
import { connection } from "next/server";

import { AdminCreateSpielortModal } from "@/features/spielorte/components/modals/AdminCreateSpielortModal";
import { AdminSpielorteView } from "@/features/spielorte/components/views/AdminSpielorteView";
import { SPIELORTE_CRUD_COPY } from "@/features/spielorte/constants";
import { getSpielorte } from "@/features/spielorte/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

// Not async — see the note on the schiedsrichter page; same split, same reason.
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
  // Retired venues included: this list is the only surface that can bring one back (ADR-0025). Its own
  // cache entry, separate from the picker's `getSpielorte()` — the key is the arguments, so the picker
  // keeps offering live venues only.
  const spielorteRes = await getSpielorte({ include_inactive: true });

  return <AdminSpielorteView spielorte={spielorteRes.spielorte} />;
}
