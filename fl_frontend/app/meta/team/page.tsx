import Team from "@/features/meta/components/Team";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "Team",
  description:
    "Auf der Team-Seite erfährst Du mehr über das Team hinter der Frankfurt-Fußball-League, wer für was Verantwortlich ist und wie die Organisation abläuft.",
  keywords: ["Frankfurt-League Team", "Team"],
  alternates: {
    canonical: "https://frankfurtleague.de/meta/team",
  },
};

export default async function TeamPage() {
  return <Team />;
}
