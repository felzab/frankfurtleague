import About from "@/features/meta/components/About";
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "About",
  description:
    "Erfahre mehr darüber, was die Frankfurt-Fußball-League ist, warum sie ins Leben gerufen wurde und wie sie das Fußballumfeld in Frankfurt weiterbringt.",
  keywords: ["Frankfurt-League About", "About"],
  alternates: {
    canonical: "https://frankfurtleague.de/meta/about",
  },
};

export default async function AboutPage() {
  return <About />;
}
