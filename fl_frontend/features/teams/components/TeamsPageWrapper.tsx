"use client";

import { useState } from "react";
import TeamDetailDisplay from "./TeamDetailDisplay";
import TeamsGrid from "./TeamsGrid";
import type { FLTeam } from "../types";
import type { FLSpiel } from "@/features/spiele/types";

export default function TeamsPageWrapper({ teams, spiele }: { teams: FLTeam[]; spiele: FLSpiel[] }) {
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);

  const selectedTeam = teams.find((t) => t.id === selectedTeamId);

  const today = new Date().toISOString().split("T")[0];

  // Otherwise, show the Overview Grid
  return (
    <div className="flex flex-col h-full w-[95%] max-w-[1550px] gap-y-2 p-5 rounded-2xl mt-2 bg-tertiary-light dark:bg-tertiary-dark text-text-black dark:text-text-white overflow-y-scroll scrollbar-hide">
      {selectedTeam ? (
        <TeamDetailDisplay
          teamData={selectedTeam}
          spiele={spiele.filter((spiel) => spiel.team1.team_id === selectedTeamId || spiel.team2.team_id === selectedTeamId)}
          onBack={() => setSelectedTeamId(null)}
          today={today}
        />
      ) : (
        <>
          <div className="flex flex-col mb-8 gap-y-2">
            <h3 className="text-fluid-lg lg:text-fluid-xl font-extrabold tracking-tight">Teams der Frankfurt-League</h3>
            <p className="text-fluid-xs whitespace-normal w-[80%]">Wähle ein Team aus, um Teamdaten, Statistiken etc. zu sehen.</p>
          </div>
          <TeamsGrid
            teams={teams}
            onSelect={setSelectedTeamId}
          />
        </>
      )}
    </div>
  );
}
