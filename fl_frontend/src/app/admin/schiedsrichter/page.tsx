import { Suspense } from "react";
import { connection } from "next/server";

import { AdminCreateSchiedsrichterModal } from "@/features/schiedsrichter/components/modals/AdminCreateSchiedsrichterModal";
import { AdminSchiedsrichterView } from "@/features/schiedsrichter/components/views/AdminSchiedsrichterView";
import { getSchiedsrichter } from "@/features/schiedsrichter/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

// Not async, so the chrome never waits on the referee list. Passing the page title to a client
// element built after `await getSchiedsrichter()` would put a static heading behind a FastAPI
// round-trip. `connection()` sits down in SchiedsrichterTable with the fetch it guards — ADR-0009
// requires only that nothing fetches at build time.
export default function AdminSchiedsrichterPage() {
  return (
    <AdminCrudShell createModal={<AdminCreateSchiedsrichterModal />}>
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
