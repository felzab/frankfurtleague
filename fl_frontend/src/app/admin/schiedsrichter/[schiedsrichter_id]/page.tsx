import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AdminSchiedsrichterEditView } from "@/features/schiedsrichter/components/views/AdminSchiedsrichterEditView";
import { getSchiedsrichter } from "@/features/schiedsrichter/queries";
import { resolveSchiedsrichterId } from "@/features/schiedsrichter/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";

import type { NextPageProps } from "@/shared/types/types";

/**
 * The referee editor (ADR-0040). One referee per URL, and no season in it: a referee belongs to the
 * league rather than to a season, so the sidemenu's selector changes nothing on this page.
 *
 * No `generateMetadata` and no `generateStaticParams`, for the reasons the match editor records.
 * **The page itself resolves NOTHING** — every await happens inside the `Suspense` boundary, which
 * is what keeps a fallback-params route renderable (the match editor documents the crash).
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

  // The list read rather than `GET /schiedsrichter/{id}`: it is already cached under the `schiedsrichter`
  // tag every write on this page invalidates, so the editor costs no second cache entry. Retired
  // referees are excluded by it, which is why this route answers not-found for one — they are in no
  // list and behind no link either.
  const schiedsrichterRes = await getSchiedsrichter();
  const schiedsrichter = schiedsrichterRes.schiedsrichter.find((candidate) => candidate.id === schiedsrichterId);
  if (!schiedsrichter) {
    notFound();
  }

  return (
    // Keyed by the state the draft mirrors — the match editor's reason: the same route pattern
    // reconciles in place, and a saved referee must reopen with their saved values.
    <AdminSchiedsrichterEditView
      key={JSON.stringify(schiedsrichter)}
      schiedsrichter={{
        id: schiedsrichter.id,
        name: schiedsrichter.name,
        schule: schiedsrichter.schule,
        kontakt: schiedsrichter.kontakt,
        default_payment: schiedsrichter.default_payment,
      }}
    />
  );
}
