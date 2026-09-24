import { PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";

import { TeamAustrittNote } from "../ui/TeamAustrittNote";
import { TeamDetailsBackButton } from "../ui/TeamDetailsBackButton";
import { TeamIdentityCard } from "../ui/TeamIdentityCard";
import { TeamSaisonSpieleTimeline } from "../ui/TeamSaisonSpieleTimeline";
import { TeamSaisonStatistik } from "../ui/TeamSaisonStatistik";
import { TeamSaisonVerlauf } from "../ui/TeamSaisonVerlauf";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLTeam } from "../../schemas";

/**
 * Composition only, and nothing here hands a function to a client leaf — the callbacks live below
 * the boundary, on the side that holds the state (`docs/frontend/spec.md :: I13`).
 */
export function TeamDetailsView({
  teamData,
  teamSpiele,
  today,
  saisonId,
  isFinishedSaison,
}: {
  teamData: FLTeam;
  teamSpiele: FLSpiel[];
  today: string;
  saisonId: string | undefined;
  isFinishedSaison: boolean;
}) {
  return (
    <div className={`${PAGE_RISE_CLASSES} flex w-full flex-col gap-y-8 pb-12`}>
      <TeamDetailsBackButton saisonId={saisonId} />

      <TeamIdentityCard teamData={teamData} />

      <TeamAustrittNote austritt={teamData.austritt} />

      <TeamSaisonStatistik statistik={teamData.statistik} />

      <TeamSaisonVerlauf
        teamSpiele={teamSpiele}
        teamId={teamData.id}
      />

      <TeamSaisonSpieleTimeline
        teamSpiele={teamSpiele}
        teamId={teamData.id}
        today={today}
        isFinishedSaison={isFinishedSaison}
      />
    </div>
  );
}
