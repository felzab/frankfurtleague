"use client";

import { createContext, useContext } from "react";

import type { FLTeamDraftStatus, FLTeamFieldStatus } from "@/features/teams/teamDraftStatus";
import type { ReactNode } from "react";

/**
 * Carries `deriveTeamDraftStatus`'s answer to every field of the club editor — the same shape the
 * match editor's `DraftStatusContext` carries for its own draft, and folder-scoped for the same
 * reason: nothing outside this editor has a club draft to describe.
 */
const TeamDraftStatusContext = createContext<FLTeamDraftStatus | undefined>(undefined);

export function TeamDraftStatusProvider({ status, children }: { status: FLTeamDraftStatus; children: ReactNode }) {
  // No `useMemo`: the status object is rebuilt on every render by design — the draft it describes is
  // too — so memoising the provider value would allocate a comparison and never skip a render.
  return <TeamDraftStatusContext.Provider value={status}>{children}</TeamDraftStatusContext.Provider>;
}

/** The whole picture, for the rail and the action bar. */
export function useTeamDraftStatus(): FLTeamDraftStatus {
  const status = useContext(TeamDraftStatusContext);
  if (status === undefined) {
    throw new Error("useTeamDraftStatus must be used within a TeamDraftStatusProvider");
  }
  return status;
}

/** One field's status by its payload path; `undefined` for a path with no descriptor. */
export function useTeamFieldStatus(path: string): FLTeamFieldStatus | undefined {
  return useTeamDraftStatus().byPath.get(path);
}
