import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminSpielortEditView } from "@/features/spielorte/components/views/AdminSpielortEditView";
import { getSpielorte } from "@/features/spielorte/queries";
import { resolveSpielortId } from "@/features/spielorte/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

import type { NextPageProps } from "@/shared/types/types";

/**
 * The venue editor. One venue per URL, and no season in it: a venue belongs to the league
 * rather than to a season, so the sidemenu's selector changes nothing on this page.
 *
 * No `generateMetadata` and no `generateStaticParams`, for the reasons the match editor records.
 * **The page itself resolves NOTHING** — every await happens inside the `Suspense` boundary, which
 * is what keeps a fallback-params route renderable (the match editor documents the crash).
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

  // The list read, not `GET /spielorte/{id}`: already cached under the tag this page's write clears.
  // `include_inactive` matches the list this page opens from — without it a retired venue's own editor
  // answers not-found.
  const spielorteRes = await getSpielorte({ include_inactive: true });
  const spielort = spielorteRes.spielorte.find((candidate) => candidate.id === spielortId);
  if (!spielort) {
    notFound();
  }

  return (
    // Keyed by the state the draft mirrors — the match editor's reason: the same route pattern
    // reconciles in place, and a saved venue must reopen with its saved values.
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
