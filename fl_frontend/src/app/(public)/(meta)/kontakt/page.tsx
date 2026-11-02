import { Suspense } from "react";

import { KONTAKT_TITEL } from "@/core/seitenNamen";
import { BewerbungOffenBand } from "@/features/bewerbungen/components/ui/BewerbungOffenBand";
import { KontaktView } from "@/features/meta/components/views/KontaktView";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return {
    title: KONTAKT_TITEL,
    description: "So erreichst Du die Frankfurt League mit Fragen, Anregungen und allem Weiteren.",
    openGraph: await openGraphFor(parent, "/kontakt"),
    alternates: {
      canonical: "/kontakt",
    },
  };
}

export default function KontaktPage() {
  return (
    <KontaktView
      // A slot the view seats, never a band rendered beside it: where this belongs relative to the
      // heading and the channels is a fact about `KontaktView`, and only that component holds it.
      bewerbungSlot={
        <Suspense fallback={null}>
          <BewerbungOffenBand />
        </Suspense>
      }
    />
  );
}
