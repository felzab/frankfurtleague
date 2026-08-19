import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminSchiedsrichterEditView } from "@/features/schiedsrichter/components/views/AdminSchiedsrichterEditView";
import { getSchiedsrichter } from "@/features/schiedsrichter/queries";
import { resolveSchiedsrichterId } from "@/features/schiedsrichter/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

import type { NextPageProps } from "@/shared/types/types";

/**
 * The referee editor. One per URL and no season in it: a referee belongs to the league, so the
 * sidemenu's selector changes nothing here. It resolves nothing itself — see the match editor.
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

  // The list read, already cached under the tag this page's write clears. `include_inactive`, or
  // a retired referee's own editor answers not-found.
  const schiedsrichterRes = await getSchiedsrichter({ include_inactive: true });
  const schiedsrichter = schiedsrichterRes.schiedsrichter.find((candidate) => candidate.id === schiedsrichterId);
  if (!schiedsrichter) {
    notFound();
  }

  return (
    // Keyed by the state the draft mirrors, for the match editor's reason.
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
    />
  );
}
