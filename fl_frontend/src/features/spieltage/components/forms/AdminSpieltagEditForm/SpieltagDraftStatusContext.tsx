"use client";

import { createContext, useContext } from "react";

import type { FLSpieltagDraftStatus, FLSpieltagFieldStatus } from "@/features/spieltage/spieltagDraftStatus";
import type { ReactNode } from "react";

/**
 * Carries `deriveSpieltagDraftStatus`'s answer to every field of the matchday editor — the same
 * shape the club editor's `TeamDraftStatusContext` carries for its own draft, and folder-scoped for
 * the same reason: nothing outside this editor has a matchday draft to describe.
 */
const SpieltagDraftStatusContext = createContext<FLSpieltagDraftStatus | undefined>(undefined);

export function SpieltagDraftStatusProvider({ status, children }: { status: FLSpieltagDraftStatus; children: ReactNode }) {
  // No `useMemo`: the status object is rebuilt on every render by design — the draft it describes is
  // too — so memoising the provider value would allocate a comparison and never skip a render.
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
