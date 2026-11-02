import { ORGANISATION_TITEL } from "@/core/seitenNamen";
import { MetaOrganisationView } from "@/features/meta/components/views/MetaOrganisationView";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return {
    title: ORGANISATION_TITEL,
    description: "Die Menschen hinter der Frankfurt League und wer bei uns was macht.",
    openGraph: await openGraphFor(parent, "/organisation"),
    alternates: {
      canonical: "/organisation",
    },
  };
}

export default function MetaTeamPage() {
  return <MetaOrganisationView />;
}
