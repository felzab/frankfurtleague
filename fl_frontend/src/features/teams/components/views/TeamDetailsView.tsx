import { PAGE_RISE } from "@/shared/components/ui/motion";

import { TeamDetailsBackButton } from "../ui/TeamDetailsBackButton";
import { TeamDisqualifikationNote } from "../ui/TeamDisqualifikationNote";
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
export function TeamDetailsView({ teamData, teamSpiele, today }: { teamData: FLTeam; teamSpiele: FLSpiel[]; today: string }) {
  return (
    <div className={`${PAGE_RISE} flex w-full flex-col gap-y-8 pb-12`}>
      <TeamDetailsBackButton />

      <TeamIdentityCard teamData={teamData} />

      <TeamDisqualifikationNote disqualifikation={teamData.disqualifikation} />

      <TeamSaisonStatistik statistik={teamData.statistik} />

      <TeamSaisonVerlauf
        teamSpiele={teamSpiele}
        teamId={teamData.id}
      />

      <TeamSaisonSpieleTimeline
        teamSpiele={teamSpiele}
        teamId={teamData.id}
        today={today}
      />
    </div>
  );
}
