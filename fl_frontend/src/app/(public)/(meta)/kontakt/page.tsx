import KontaktView from "@/features/meta/components/views/KontaktView";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kontakt",
  description:
    "Auf der Kontakt-Seite erfährst Du, wie Du dich mit der Frankfurt-League in Verbindung setzen und Hilfe zu Fragen und Weiterem erhalten kannst.",
  keywords: ["Frankfurt-League Kontakt", "Kontakt"],
  alternates: {
    canonical: "https://frankfurtleague.de/kontakt",
  },
};

export default async function KontaktPage() {
  return <KontaktView />;
}
