import { connection } from "next/server";

import { TeamStartView } from "@/features/funktionen/components/views/TeamStartView";
import { getTeamSitze } from "@/features/funktionen/queries";
import { readAsSeatHolder, requireTeamSeats } from "@/features/funktionen/resolvers";

import type { NextPageProps } from "@/shared/types/types";

/** A seat holder's landing on their team: their own roles from the session, and the three seats read after the seat check. */
export default async function TeamStartPage({ params }: NextPageProps<{ team_id: string; saison_id: string }>) {
  await connection();
  const seats = await requireTeamSeats(params);
  if (seats === null) return null;

  const { team_id, saison_id } = await params;
  const read = await readAsSeatHolder(() => getTeamSitze(team_id, saison_id));
  if ("forbidden" in read) return read.forbidden;

  return (
    <TeamStartView
      seats={seats}
      sitze={read.data.sitze}
    />
  );
}
