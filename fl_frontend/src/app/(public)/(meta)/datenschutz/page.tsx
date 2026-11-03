import { DATENSCHUTZ_TITEL } from "@/core/seitenNamen";
import { SERVER_COPY } from "@/core/serverCopy";
import { DatenschutzView } from "@/features/meta/components/views/DatenschutzView";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return {
    title: DATENSCHUTZ_TITEL,
    description: SERVER_COPY.description.privacyNotice,
    openGraph: await openGraphFor(parent, "/datenschutz"),
    alternates: {
      canonical: "/datenschutz",
    },
  };
}

export default function DatenschutzPage() {
  return <DatenschutzView />;
}
