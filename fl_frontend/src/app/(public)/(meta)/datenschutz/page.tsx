import { DATENSCHUTZ_TITEL } from "@/core/seitenNamen";
import { DatenschutzView } from "@/features/meta/components/views/DatenschutzView";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: DATENSCHUTZ_TITEL,
  description: "Welche Daten die Frankfurt League verarbeitet, auf welcher Grundlage und wie lange.",
  openGraph: openGraphFor("/datenschutz"),
  alternates: {
    canonical: "/datenschutz",
  },
};

export default function DatenschutzPage() {
  return <DatenschutzView />;
}
