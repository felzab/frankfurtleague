import { Suspense } from "react";

import { AdminCreateSperreModal } from "@/features/sperrliste/components/modals/AdminCreateSperreModal";
import { AdminSperrlisteView } from "@/features/sperrliste/components/views/AdminSperrlisteView";
import { SPERRLISTE_CRUD_COPY } from "@/features/sperrliste/constants";
import { getSperrliste } from "@/features/sperrliste/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

// Not async, so the chrome never waits on the list.
export default function AdminSperrlistePage() {
  return (
    <AdminCrudShell
      search={
        <AdminCrudSearch
          searchLabel={SPERRLISTE_CRUD_COPY.searchLabel}
          searchPlaceholder={SPERRLISTE_CRUD_COPY.searchPlaceholder}
        />
      }
      createModal={<AdminCreateSperreModal />}>
      <Suspense
        fallback={
          <AdminCrudFallback
            shape="cards"
            hasFacets={false}
          />
        }>
        <Sperrliste />
      </Suspense>
    </AdminCrudShell>
  );
}

/**
 * Every ban, over every season: a ban is about a person rather than about a year, so the header's
 * season selector narrows nothing here.
 */
async function Sperrliste() {
  // Not `"use cache"`, a cross-request store keyed on arguments rather than the caller:
  // `fl_frontend/src/features/sperrliste/queries.ts :: getSperrliste`.
  const sperrlisteRes = await getSperrliste();

  return (
    <AdminSperrlisteView
      sperrliste={sperrlisteRes.sperrliste}
      anzahlGesamt={sperrlisteRes.count_total}
    />
  );
}
