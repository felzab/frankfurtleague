import { connection } from "next/server";

import { funktionenOf } from "@/core/funktionen";
import { TeamForbiddenPanel } from "@/features/funktionen/components/ui/TeamForbiddenPanel";
import { requireSubjectSession, requireTeamSeats } from "@/features/funktionen/resolvers";
import { teamHref } from "@/features/funktionen/teamSeats";
import { KaderView } from "@/features/spieler/components/views/KaderView";
import { getKader } from "@/features/spieler/queries";
import { isFunktionLost } from "@/shared/utils/actionError";

import type { NextPageProps } from "@/shared/types/types";

/** A team's squad as its seat holder reads it, every seat alike. */
export default async function KaderPage({ params }: NextPageProps<{ team_id: string; saison_id: string }>) {
  await connection();
  const seats = await requireTeamSeats(params);
  if (seats === null) return null;

  const { team_id, saison_id } = await params;
  let kader;
  try {
    kader = await getKader(team_id, saison_id);
  } catch (error) {
    // The seat went between the page's own check and the backend's: the page answers as the shell does
    // for a seat not held, and every other failure is the area's boundary's.
    if (!isFunktionLost(error)) throw error;
    return <TeamForbiddenPanel funktionen={funktionenOf(await requireSubjectSession()).funktionen} />;
  }

  return (
    <KaderView
      kader={kader.kader}
      kaderHref={`${teamHref(team_id, saison_id)}/kader`}
      registrierungenHref={`${teamHref(team_id, saison_id)}/registrierungen`}
    />
  );
}
