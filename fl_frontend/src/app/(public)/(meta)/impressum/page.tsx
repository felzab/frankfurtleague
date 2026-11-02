import { IMPRESSUM_TITEL } from "@/core/seitenNamen";
import { ImpressumView } from "@/features/meta/components/views/ImpressumView";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return {
    title: IMPRESSUM_TITEL,
    description: "Anbieterkennzeichnung der Frankfurt League nach § 5 DDG und § 18 Abs. 2 MStV.",
    openGraph: await openGraphFor(parent, "/impressum"),
    alternates: {
      canonical: "/impressum",
    },
  };
}

export default function ImpressumPage() {
  return <ImpressumView />;
}
