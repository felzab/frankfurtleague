import { Suspense } from "react";
import { connection } from "next/server";

import { AdminCreateSchiedsrichterModal } from "@/features/schiedsrichter/components/modals/AdminCreateSchiedsrichterModal";
import { AdminSchiedsrichterView } from "@/features/schiedsrichter/components/views/AdminSchiedsrichterView";
import { SCHIEDSRICHTER_CRUD_COPY } from "@/features/schiedsrichter/constants";
import { getSchiedsrichterList } from "@/features/schiedsrichter/queries";
import { AdminCrudFallback } from "@/shared/components/ui/AdminCrudFallback";
import { AdminCrudSearch } from "@/shared/components/ui/AdminCrudSearch";
import { AdminCrudShell } from "@/shared/components/ui/AdminCrudShell";

import type { NextPageProps } from "@/shared/types/types";

// Not async, so the chrome never waits on the list: a static heading must not sit behind a
// round-trip.
export default function AdminSchiedsrichterPage(props: NextPageProps) {
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
        <SchiedsrichterTable searchParams={props.searchParams} />
      </Suspense>
    </AdminCrudShell>
  );
}

async function SchiedsrichterTable({ searchParams }: { searchParams: NextPageProps["searchParams"] }) {
  await connection();
  const params = (await searchParams) ?? {};
  const schiedsrichterRes = await getSchiedsrichterList(params);

  return (
    <AdminSchiedsrichterView
      schiedsrichter={schiedsrichterRes.schiedsrichter}
      anzahlJeAngabe={schiedsrichterRes.anzahl_je_angabe}
    />
  );
}
