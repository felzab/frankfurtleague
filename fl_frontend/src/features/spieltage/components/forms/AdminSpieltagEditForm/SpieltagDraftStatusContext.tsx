"use client";

import { createContext, useContext } from "react";

import type { FLSpieltagDraftStatus, FLSpieltagFieldStatus } from "@/features/spieltage/spieltagDraftStatus";
import type { ReactNode } from "react";

/** Folder-scoped: nothing outside this editor has a matchday draft to describe. */
const SpieltagDraftStatusContext = createContext<FLSpieltagDraftStatus | undefined>(undefined);

export function SpieltagDraftStatusProvider({ status, children }: { status: FLSpieltagDraftStatus; children: ReactNode }) {
  // No `useMemo`: the status object is rebuilt every render by design, so memoising would allocate a
  // comparison and never skip a render.
  return <SpieltagDraftStatusContext.Provider value={status}>{children}</SpieltagDraftStatusContext.Provider>;
}

export function useSpieltagDraftStatus(): FLSpieltagDraftStatus {
  const status = useContext(SpieltagDraftStatusContext);
  if (status === undefined) {
    throw new Error("useSpieltagDraftStatus must be used within a SpieltagDraftStatusProvider");
  }
  return status;
}

export function useSpieltagFieldStatus(path: string): FLSpieltagFieldStatus | undefined {
  return useSpieltagDraftStatus().byPath.get(path);
}
