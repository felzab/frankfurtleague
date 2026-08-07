import { Suspense } from "react";
import { connection } from "next/server";

import { AdminCreateSpielortModal } from "@/features/spielorte/components/modals/AdminCreateSpielortModal";
import { AdminSpielorteView } from "@/features/spielorte/components/views/AdminSpielorteView";
import { getSpielorte } from "@/features/spielorte/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

// Not async — see the note on the schiedsrichter page; same split, same reason.
export default function AdminSpielortePage() {
  return (
    <AdminCrudShell createModal={<AdminCreateSpielortModal />}>
      <Suspense fallback={<AdminCrudFallback />}>
        <SpielorteTable />
      </Suspense>
    </AdminCrudShell>
  );
}

async function SpielorteTable() {
  await connection();
  const spielorteRes = await getSpielorte();

  return <AdminSpielorteView spielorte={spielorteRes.spielorte} />;
}
