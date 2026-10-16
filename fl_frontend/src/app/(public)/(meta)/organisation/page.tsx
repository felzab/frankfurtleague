import { MetaOrganisationView } from "@/features/meta/components/views/MetaOrganisationView";
import { ORGANISATION_TITEL } from "@/features/meta/constants";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: ORGANISATION_TITEL,
  description: "Die Menschen hinter der Frankfurt League und wer bei uns was macht.",
  openGraph: openGraphFor("/organisation"),
  alternates: {
    canonical: "/organisation",
  },
};

export default function MetaTeamPage() {
  return <MetaOrganisationView />;
}
