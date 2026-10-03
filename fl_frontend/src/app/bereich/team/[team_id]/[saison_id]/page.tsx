import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { TeamForbiddenPanel } from "@/features/funktionen/components/ui/TeamForbiddenPanel";
import { TeamStartView } from "@/features/funktionen/components/views/TeamStartView";
import { getTeamSitze } from "@/features/funktionen/queries";
import { requireSubjectSession, requireTeamSeats } from "@/features/funktionen/resolvers";
import { isFunktionLost } from "@/shared/utils/actionError";

import type { NextPageProps } from "@/shared/types/types";

/** A seat holder's landing on their team: their own roles from the session, and the three seats read after the seat check. */
export default async function TeamStartPage({ params }: NextPageProps<{ team_id: string; saison_id: string }>) {
  await connection();
  const seats = await requireTeamSeats(params);
  if (seats === null) return null;

  const { team_id, saison_id } = await params;
  let sitze;
  try {
    ({ sitze } = await getTeamSitze(team_id, saison_id));
  } catch (error) {
    // The seat went between the page's own check and the backend's: answered as the shell answers a
    // seat not held, and every other failure is the area's boundary's.
    if (!isFunktionLost(error)) throw error;
    return <TeamForbiddenPanel funktionen={funktionenOf(await requireSubjectSession()).funktionen} />;
  }

  return (
    <TeamStartView
      seats={seats}
      sitze={sitze}
    />
  );
}
