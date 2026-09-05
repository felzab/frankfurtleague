import { MetaTeamView } from "@/features/meta/components/views/MetaTeamView";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Hinter den Kulissen",
  description: "Die Menschen hinter der Frankfurt League und wer bei uns was macht.",
  openGraph: openGraphFor("/team"),
  alternates: {
    canonical: "/team",
  },
};

export default function MetaTeamPage() {
  return <MetaTeamView />;
}
