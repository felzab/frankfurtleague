import { connection } from "next/server";

import { TeamStartView } from "@/features/funktionen/components/views/TeamStartView";
import { requireTeamSeats } from "@/features/funktionen/resolvers";

import type { NextPageProps } from "@/shared/types/types";

/** A seat holder's landing on their team: rendered from the seats alone, reading nothing past the session. */
export default async function TeamStartPage({ params }: NextPageProps<{ team_id: string; saison_id: string }>) {
  await connection();
  const seats = await requireTeamSeats(params);
  if (seats === null) return null;

  return <TeamStartView seats={seats} />;
}
