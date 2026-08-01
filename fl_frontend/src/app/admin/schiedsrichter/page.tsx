import { Suspense } from "react";
import { connection } from "next/server";

import { AdminCreateSchiedsrichterModal } from "@/features/schiedsrichter/components/modals/AdminCreateSchiedsrichterModal";
import { AdminSchiedsrichterView } from "@/features/schiedsrichter/components/views/AdminSchiedsrichterView";
import { SCHIEDSRICHTER_CRUD_COPY } from "@/features/schiedsrichter/constants";
import { getSchiedsrichter } from "@/features/schiedsrichter/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

// Not async: the chrome no longer waits on the referee list (NEW-SC11). The page title used to be a
// prop on a client element built after `await getSchiedsrichter()`, so a static heading sat behind a
// FastAPI round-trip. `connection()` moves down into SchiedsrichterTable with the fetch it guards —
// ADR-0009's requirement is that nothing fetches at build time, and that still holds.
export default function AdminSchiedsrichterPage() {
  return (
    <AdminCrudShell
      title={SCHIEDSRICHTER_CRUD_COPY.title}
      description={SCHIEDSRICHTER_CRUD_COPY.description}
      createModal={<AdminCreateSchiedsrichterModal />}>
      <Suspense fallback={<AdminCrudFallback />}>
        <SchiedsrichterTable />
      </Suspense>
    </AdminCrudShell>
  );
}

async function SchiedsrichterTable() {
  await connection();
  const schiedsrichterRes = await getSchiedsrichter();

  return <AdminSchiedsrichterView schiedsrichter={schiedsrichterRes.schiedsrichter} />;
}
