import { Suspense } from "react";
import { connection } from "next/server";

import { BewerbungView } from "@/features/bewerbungen/components/views/BewerbungView";
import { getBewerbungFenster, getBewerbungSchulen, getBewerbungTrikotfarben } from "@/features/bewerbungen/queries";
import { resolveSaisonIdParam } from "@/features/saisons/resolvers";
import { ContentLoader } from "@/shared/components/ui/ContentLoader";
import { getGermanTodayStr } from "@/shared/utils/date";
import { openGraphFor } from "@/shared/utils/metadata";

import type { NextPageProps } from "@/shared/types/types";
import type { Metadata } from "next";

export async function generateMetadata(props: NextPageProps<{ saison_id: string }>): Promise<Metadata> {
  // `generateMetadata` is not part of the App Shell, so it awaits at the top level.
  await connection();
  const saison_id = await resolveSaisonIdParam(props.params);

  return {
    title: `Bewerbung Saison ${saison_id}`,
    description: `Melde Dein Schulteam für die Saison ${saison_id} der Frankfurt-League an.`,
    openGraph: openGraphFor(`/bewerbung/${saison_id}`),
    alternates: { canonical: `/bewerbung/${saison_id}` },
  };
}

/**
 * Resolves nothing itself: a top-level await ties the FALLBACK-params App Shell to one URL, and this
 * page's whole body is a function of the season in that URL (`docs/frontend/spec.md :: I22`).
 */
export default function BewerbungPage(props: NextPageProps<{ saison_id: string }>) {
  return (
    <Suspense fallback={<ContentLoader fills="viewport" />}>
      <BewerbungContent {...props} />
    </Suspense>
  );
}

async function BewerbungContent(props: NextPageProps<{ saison_id: string }>) {
  await connection();
  const saison_id = await resolveSaisonIdParam(props.params);

  // The window alone, never the season: `docs/backend/spec.md :: I47` withholds a `future` season
  // from the base tier, and a season taking applications IS `future`.

  // Caught, so a failure reaches the view as its own state: „abgelaufen“ would be a deadline this
  // read never learnt.
  const fenster = await getBewerbungFenster(saison_id).then(
    (antwort) => ({ isUnlesbar: false, fenster: antwort }),
    () => ({ isUnlesbar: true, fenster: null }),
  );

  // A closed page shows no picker, and the club list is a read of the league's roster nothing on
  // such a page asked for. A failure degrades to the new-school arm rather than taking the whole
  // form down with it.
  const schulen =
    fenster.fenster?.laeuft === true
      ? await getBewerbungSchulen().then(
          (antwort) => ({ isSchulenLesbar: true, schulen: antwort.schulen }),
          () => ({ isSchulenLesbar: false, schulen: [] }),
        )
      : { isSchulenLesbar: true, schulen: [] };

  // Degraded to the EMPTY set: an unreadable answer means nothing is KNOWN to be taken, offering
  // the whole palette.
  const vergeben =
    fenster.fenster?.laeuft === true
      ? await getBewerbungTrikotfarben(saison_id).then(
          (antwort) => antwort.vergeben,
          () => [],
        )
      : [];

  return (
    <BewerbungView
      saisonId={saison_id}
      fenster={fenster.fenster}
      isUnlesbar={fenster.isUnlesbar}
      // Legal here: the connection() above already made the scope dynamic.
      today={getGermanTodayStr()}
      schulen={schulen.schulen}
      isSchulenLesbar={schulen.isSchulenLesbar}
      vergebeneFarben={vergeben}
    />
  );
}
