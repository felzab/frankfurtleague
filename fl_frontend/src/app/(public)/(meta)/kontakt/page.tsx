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
  return <KontaktView />;
}
