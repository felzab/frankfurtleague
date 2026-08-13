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

  // The list read, not `GET /schiedsrichter/{id}`: already cached under the tag this page's write
  // clears, so no second entry. It excludes retired referees — hence not-found for one, which is
  // where every list and link already leaves them.
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
