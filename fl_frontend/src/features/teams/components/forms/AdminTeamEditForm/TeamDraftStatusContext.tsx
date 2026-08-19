"use client";

import { createContext, useContext } from "react";

import type { FLTeamDraftStatus, FLTeamFieldStatus } from "@/features/teams/teamDraftStatus";
import type { ReactNode } from "react";

/** Folder-scoped: nothing outside this editor has a club draft to describe. */
const TeamDraftStatusContext = createContext<FLTeamDraftStatus | undefined>(undefined);

export function TeamDraftStatusProvider({ status, children }: { status: FLTeamDraftStatus; children: ReactNode }) {
  // No `useMemo`: the status object is rebuilt every render by design, so memoising the value would
  // allocate a comparison and never skip a render.
  return <TeamDraftStatusContext.Provider value={status}>{children}</TeamDraftStatusContext.Provider>;
}

export function useTeamDraftStatus(): FLTeamDraftStatus {
  const status = useContext(TeamDraftStatusContext);
  if (status === undefined) {
    throw new Error("useTeamDraftStatus must be used within a TeamDraftStatusProvider");
  }
  return status;
}

export function useTeamFieldStatus(path: string): FLTeamFieldStatus | undefined {
  return useTeamDraftStatus().byPath.get(path);
}
