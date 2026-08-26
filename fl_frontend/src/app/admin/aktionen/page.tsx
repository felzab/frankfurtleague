import { Suspense } from "react";
import { connection } from "next/server";

import { AdminAktionenView } from "@/features/aktionen/components/views/AdminAktionenView";
import { AKTIONEN_CRUD_COPY } from "@/features/aktionen/constants";
import { getAktionen } from "@/features/aktionen/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { AdminAktionRow } from "@/features/aktionen/types";

// Not async, so the chrome never waits on the list: the search field must not sit behind a
// round-trip. No create control at all, since every row here is written by one of the other pages.
export default function AdminAktionenPage() {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={AKTIONEN_CRUD_COPY.searchLabel}
          searchPlaceholder={AKTIONEN_CRUD_COPY.searchPlaceholder}
          // This shell passes no `createModal`, so the bar has no trigger to join: it keeps its own
          // right edge and the row's full width.
          attachEnd={false}
        />
      }>
      <Suspense fallback={<AdminCrudFallback />}>
        <AktionenTable />
      </Suspense>
    </AdminCrudShell>
  );
}

async function AktionenTable() {
  // The image builder reaches no backend, so the fetch below has to be kept out of the build.
  await connection();
  const aktionenRes = await getAktionen();

  // An empty ARRAY is a removal whose filter matched nothing, which secured no document — distinct
  // from null, which is a write that kept no image at all, and the two must not badge alike.
  const rows: AdminAktionRow[] = aktionenRes.aktionen.map(({ before, ...aktion }) => ({
    ...aktion,
    standGesichert: Array.isArray(before) ? before.length > 0 : before !== null,
  }));

  return <AdminAktionenView aktionen={rows} />;
}
