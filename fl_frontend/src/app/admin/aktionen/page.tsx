import { Suspense } from "react";
import { connection } from "next/server";

import { AdminAktionenView } from "@/features/aktionen/components/views/AdminAktionenView";
import { AKTIONEN_CRUD_COPY } from "@/features/aktionen/constants";
import { getAktionenLog, readAktionenLogSubjekt } from "@/features/aktionen/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";
import { parseLeserichtung } from "@/shared/utils/leserichtung";

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
  await connection();
  const params = (await searchParams) ?? {};
  const { dokumentId, vorgangId } = readAktionenLogSubjekt(params);
  const aktionenRes = await getAktionenLog(params);

  return (
    <AdminAktionenView
      aktionen={aktionenRes.aktionen}
      vollstaendig={aktionenRes.vollstaendig}
      anzahlJeCollection={aktionenRes.anzahl_je_collection}
      anzahlJeOperation={aktionenRes.anzahl_je_operation}
      dokumentId={dokumentId}
      vorgangId={vorgangId}
      // Re-read here as the narrowings are, so the rows served and the control naming their end
      // cannot answer one query string differently.
      richtung={parseLeserichtung(params)}
    />
  );
}
