import { AboutView } from "@/features/meta/components/views/AboutView";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "Erfahre mehr darüber, was die Frankfurt-League ist, warum sie ins Leben gerufen wurde und wie sie das Fußballumfeld in Frankfurt weiterbringt.",
  alternates: {
    canonical: "/about",
  },
};

export default function AboutPage() {
  return <AboutView />;
}
