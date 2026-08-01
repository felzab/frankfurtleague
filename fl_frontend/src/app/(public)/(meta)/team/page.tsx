import { MetaTeamView } from "@/features/meta/components/views/MetaTeamView";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Team",
  description:
    "Auf der Team-Seite erfährst Du mehr über das Team hinter der Frankfurt-League, wer für was Verantwortlich ist und wie die Organisation abläuft.",
  openGraph: openGraphFor("/team"),
  alternates: {
    canonical: "/team",
  },
};

export default function MetaTeamPage() {
  return <MetaTeamView />;
}
