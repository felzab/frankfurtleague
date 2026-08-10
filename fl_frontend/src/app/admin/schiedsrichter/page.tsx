import { Suspense } from "react";
import { connection } from "next/server";

import { AdminCreateSchiedsrichterModal } from "@/features/schiedsrichter/components/modals/AdminCreateSchiedsrichterModal";
import { AdminSchiedsrichterView } from "@/features/schiedsrichter/components/views/AdminSchiedsrichterView";
import { SCHIEDSRICHTER_CRUD_COPY } from "@/features/schiedsrichter/constants";
import { getSchiedsrichter } from "@/features/schiedsrichter/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

// Not async, so the chrome never waits on the referee list
// (`fl_frontend/src/app/admin/layout.tsx :: AdminLayout`). Passing the page title to a client element
// built after `await getSchiedsrichter()` would put a static heading behind a round-trip.
export default function AdminSchiedsrichterPage() {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={SCHIEDSRICHTER_CRUD_COPY.searchLabel}
          searchPlaceholder={SCHIEDSRICHTER_CRUD_COPY.searchPlaceholder}
        />
      }
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
