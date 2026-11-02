import { ABOUT_TITEL } from "@/core/seitenNamen";
import { AboutView } from "@/features/meta/components/views/AboutView";
import { openGraphFor } from "@/shared/utils/metadata";

import type { Metadata, ResolvingMetadata } from "next";

export async function generateMetadata(_: unknown, parent: ResolvingMetadata): Promise<Metadata> {
  return {
    title: ABOUT_TITEL,
    description: "Was die Frankfurt League ist, warum es sie gibt und nach welchen Regeln gespielt wird.",
    openGraph: await openGraphFor(parent, "/about"),
    alternates: {
      canonical: "/about",
    },
  };
}

export default function AboutPage() {
  return <AboutView />;
}
