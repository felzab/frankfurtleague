import About from "@/features/meta/components/About";
import { getAllTeams } from "@/features/teams/queries";
import { Metadata } from "next";
import { connection } from "next/server";

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
  await connection();
  const res = await getAllTeams();
  return <About allTeams={res.teams} />;
}
