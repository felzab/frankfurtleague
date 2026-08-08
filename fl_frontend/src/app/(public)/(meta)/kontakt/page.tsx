import { KontaktView } from "@/features/meta/components/views/KontaktView";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Kontakt",
  description:
    "Auf der Kontakt-Seite erfährst Du, wie Du Dich mit der Frankfurt-League in Verbindung setzen und Hilfe zu Fragen und Weiterem erhalten kannst.",
  openGraph: openGraphFor("/kontakt"),
  alternates: {
    canonical: "/kontakt",
  },
};

export default function KontaktPage() {
  return <KontaktView />;
}
