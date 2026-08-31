import { Suspense } from "react";
import { connection } from "next/server";

import { AdminAktionenView } from "@/features/aktionen/components/views/AdminAktionenView";
import { AKTIONEN_CRUD_COPY } from "@/features/aktionen/constants";
import { getAktionen } from "@/features/aktionen/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { NextPageProps } from "@/shared/types/types";

// Not async, so the chrome never waits on the list: the search field must not sit behind a
// round-trip. No create control at all, since every row here is written by one of the other pages.
export default function AdminAktionenPage(props: NextPageProps) {
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
        <AktionenTable searchParams={props.searchParams} />
      </Suspense>
    </AdminCrudShell>
  );
}

async function AktionenTable({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  // The image builder reaches no backend, so the fetch below has to be kept out of the build.
  await connection();
  const params = (await searchParams) ?? {};
  // Anything but one plain value reads as no narrowing, so a hand-edited URL falls back to the
  // whole log rather than 404ing — `parseLeserichtung`'s rule, one queue over.
  const dokumentId = typeof params.document_id === "string" && params.document_id !== "" ? params.document_id : undefined;
  const aktionenRes = await getAktionen(dokumentId);

  return (
    <AdminAktionenView
      aktionen={aktionenRes.aktionen}
      vollstaendig={aktionenRes.vollstaendig}
      dokumentId={dokumentId ?? null}
    />
  );
}
