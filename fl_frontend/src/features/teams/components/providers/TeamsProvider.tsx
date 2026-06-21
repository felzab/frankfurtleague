"use client";

import { createContext, useContext, ReactNode } from "react";
import type { FLTeamCompact } from "../../schemas";

const TeamsContext = createContext<FLTeamCompact[] | undefined>(undefined);

export function useTeams() {
  const context = useContext(TeamsContext);
  if (context === undefined) {
    throw new Error("useTeams must be used within a TeamsProvider");
  }
  return context;
}

export function TeamsProvider({ teams, children }: { teams: FLTeamCompact[]; children: ReactNode }) {
  return <TeamsContext.Provider value={teams}>{children}</TeamsContext.Provider>;
}
