import MetaTeamView from "@/features/meta/components/views/MetaTeamView";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Team",
  description:
    "Auf der Team-Seite erfährst Du mehr über das Team hinter der Frankfurt-League, wer für was Verantwortlich ist und wie die Organisation abläuft.",
  keywords: ["Frankfurt-League Team", "Team"],
  alternates: {
    canonical: "https://frankfurtleague.de/team",
  },
};

export default function MetaTeamPage() {
  return <MetaTeamView />;
}
