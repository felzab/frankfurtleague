import { connection } from "next/server";

import { readAsSeatHolder, requireTeamSeats } from "@/features/funktionen/resolvers";
import { teamHref } from "@/features/funktionen/teamSeats";
import { KaderView } from "@/features/spieler/components/views/KaderView";
import { getKader } from "@/features/spieler/queries";

import type { NextPageProps } from "@/shared/types/types";

/** A team's squad as its seat holder reads it, every seat alike. */
export default async function KaderPage({ params }: NextPageProps<{ team_id: string; saison_id: string }>) {
  await connection();
  const seats = await requireTeamSeats(params);
  if (seats === null) return null;

  const { team_id, saison_id } = await params;
  const read = await readAsSeatHolder(() => getKader(team_id, saison_id));
  if ("forbidden" in read) return read.forbidden;

  return (
    <KaderView
      kader={read.data.kader}
      kaderHref={`${teamHref(team_id, saison_id)}/kader`}
      registrierungenHref={`${teamHref(team_id, saison_id)}/registrierungen`}
    />
  );
}
