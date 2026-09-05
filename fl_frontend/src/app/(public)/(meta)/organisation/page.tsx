import { MetaOrganisationView } from "@/features/meta/components/views/MetaOrganisationView";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Organisation",
  description: "Die Menschen hinter der Frankfurt League und wer bei uns was macht.",
  openGraph: openGraphFor("/organisation"),
  alternates: {
    canonical: "/organisation",
  },
};

export default function MetaTeamPage() {
  return <MetaOrganisationView />;
}
