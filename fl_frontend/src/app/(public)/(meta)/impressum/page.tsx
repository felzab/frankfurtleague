import { ImpressumView } from "@/features/meta/components/views/ImpressumView";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Impressum",
  description: "Anbieterkennzeichnung der Frankfurt-League nach § 5 DDG und § 18 Abs. 2 MStV.",
  openGraph: openGraphFor("/impressum"),
  alternates: {
    canonical: "/impressum",
  },
};

export default function ImpressumPage() {
  return <ImpressumView />;
}
