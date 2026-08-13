"use client";

import { createContext, useContext } from "react";

import type { FLSpielortDraftStatus, FLSpielortFieldStatus } from "@/features/spielorte/spielortDraftStatus";
import type { ReactNode } from "react";

/**
 * Carries `deriveSpielortDraftStatus`'s answer to every field of the venue editor — the same
 * shape the club editor's `TeamDraftStatusContext` carries for its own draft, and folder-scoped for
 * the same reason: nothing outside this editor has a venue draft to describe.
 */
const SpielortDraftStatusContext = createContext<FLSpielortDraftStatus | undefined>(undefined);

export function SpielortDraftStatusProvider({ status, children }: { status: FLSpielortDraftStatus; children: ReactNode }) {
  // No `useMemo`: the status object is rebuilt on every render by design — the draft it describes is
  // too — so memoising the provider value would allocate a comparison and never skip a render.
  return <SpielortDraftStatusContext.Provider value={status}>{children}</SpielortDraftStatusContext.Provider>;
}

export function useSpielortDraftStatus(): FLSpielortDraftStatus {
  const status = useContext(SpielortDraftStatusContext);
  if (status === undefined) {
    throw new Error("useSpielortDraftStatus must be used within a SpielortDraftStatusProvider");
  }
  return status;
}

export function useSpielortFieldStatus(path: string): FLSpielortFieldStatus | undefined {
  return useSpielortDraftStatus().byPath.get(path);
}
