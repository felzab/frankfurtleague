import { AboutView } from "@/features/meta/components/views/AboutView";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Über die Liga",
  description: "Was die Frankfurt League ist, warum es sie gibt und nach welchen Regeln gespielt wird.",
  openGraph: openGraphFor("/about"),
  alternates: {
    canonical: "/about",
  },
};

export default function AboutPage() {
  return <AboutView />;
}
