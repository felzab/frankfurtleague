import { IMPRESSUM_TITEL } from "@/core/seitenNamen";
import { SERVER_COPY } from "@/core/serverCopy";
import { ImpressumView } from "@/features/meta/components/views/ImpressumView";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return {
    title: IMPRESSUM_TITEL,
    description: SERVER_COPY.description.legalNotice,
    openGraph: await openGraphFor(parent, "/impressum"),
    alternates: {
      canonical: "/impressum",
    },
  };
}

export default function ImpressumPage() {
  return <ImpressumView />;
}
