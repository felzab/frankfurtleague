import { Suspense } from "react";

import { BewerbungOffenBand } from "@/features/bewerbungen/components/ui/BewerbungOffenBand";
import { KontaktView } from "@/features/meta/components/views/KontaktView";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kontakt",
  description: "So erreichst Du die Frankfurt-League mit Fragen, Anregungen und allem Weiteren.",
  openGraph: openGraphFor("/kontakt"),
  alternates: {
    canonical: "/kontakt",
  },
};

export default function KontaktPage() {
  return (
    <KontaktView
      // A slot the view seats, never a band rendered beside it: where this belongs relative to the
      // heading and the channels is a fact about `KontaktView`, and only that component holds it.
      bewerbungSlot={
        <Suspense fallback={null}>
          <BewerbungOffenBand ground="field" />
        </Suspense>
      }
    />
  );
}
