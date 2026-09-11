import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminSchiedsrichterEditView } from "@/features/schiedsrichter/components/views/AdminSchiedsrichterEditView";
import { getSchiedsrichterById } from "@/features/schiedsrichter/queries";
import { resolveSchiedsrichterId } from "@/features/schiedsrichter/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

import type { NextPageProps } from "@/shared/types/types";

/**
 * The referee editor. One per URL and no season in it: a referee belongs to the league, so the
 * sidemenu's selector changes nothing here. It resolves nothing itself (`docs/frontend/spec.md :: I22`).
 */
export default function AdminSchiedsrichterEditPage(props: NextPageProps<{ schiedsrichter_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <AdminSchiedsrichterEditContent params={props.params} />
    </Suspense>
  );
}

async function AdminSchiedsrichterEditContent({ params }: { params: NextPageProps<{ schiedsrichter_id: string }>["params"] }) {
  await connection();
  const schiedsrichterId = await resolveSchiedsrichterId(params);

  // By id and never off the referee list: this route is the erased referee's only record, and a read
  // taken from the list would answer not-found for them (`docs/backend/spec.md :: I227`).
  const schiedsrichterRes = await getSchiedsrichterById(schiedsrichterId);
  if (schiedsrichterRes === null) {
    notFound();
  }
  const { schiedsrichter } = schiedsrichterRes;

  return (
    // Keyed by the state the draft mirrors (`docs/frontend/spec.md :: The editor's subtree is keyed by the fixture's stored state`).
    <AdminSchiedsrichterEditView
      key={JSON.stringify(schiedsrichter)}
      schiedsrichter={{
        id: schiedsrichter.id,
        name: schiedsrichter.name,
        schule: schiedsrichter.schule,
        kontakt: schiedsrichter.kontakt,
        default_payment: schiedsrichter.default_payment,
      }}
      inactiveSince={schiedsrichter.inactive_since}
      anonymisiertAm={schiedsrichter.anonymisiert_am}
    />
  );
}
