import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminSpielortEditView } from "@/features/spielorte/components/views/AdminSpielortEditView";
import { getSpielorte } from "@/features/spielorte/queries";
import { resolveSpielortId } from "@/features/spielorte/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

import type { NextPageProps } from "@/shared/types/types";

/**
 * The venue editor. One per URL and no season in it: a venue belongs to the league, so the
 * sidemenu's selector changes nothing here. It resolves nothing itself (`docs/frontend/spec.md :: I22`).
 */
export default function AdminSpielortEditPage(props: NextPageProps<{ spielort_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader />}>
      <AdminSpielortEditContent params={props.params} />
    </Suspense>
  );
}

async function AdminSpielortEditContent({ params }: { params: NextPageProps<{ spielort_id: string }>["params"] }) {
  await connection();
  const spielortId = await resolveSpielortId(params);

  // `include_inactive`, or a retired venue's own editor answers not-found.
  const spielorteRes = await getSpielorte({ include_inactive: true });
  const spielort = spielorteRes.spielorte.find((candidate) => candidate.id === spielortId);
  if (!spielort) {
    notFound();
  }

  return (
    // Keyed by the state the draft mirrors (`docs/frontend/spec.md :: The editor's subtree is keyed`).
    <AdminSpielortEditView
      key={JSON.stringify(spielort)}
      spielort={{
        id: spielort.id,
        name: spielort.name,
        address: spielort.address,
        default_mietpreis: spielort.default_mietpreis,
      }}
      inactiveSince={spielort.inactive_since}
    />
  );
}
