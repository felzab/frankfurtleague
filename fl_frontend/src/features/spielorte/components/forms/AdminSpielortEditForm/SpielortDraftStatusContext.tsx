"use client";

import { createContext, useContext } from "react";

import type { FLSpielortDraftStatus, FLSpielortFieldStatus } from "@/features/spielorte/spielortDraftStatus";
import type { ReactNode } from "react";

const SpielortDraftStatusContext = createContext<FLSpielortDraftStatus | undefined>(undefined);

export function SpielortDraftStatusProvider({ status, children }: { status: FLSpielortDraftStatus; children: ReactNode }) {
  // No `useMemo`: the status object is rebuilt every render by design, so memoising the provider
  // value would allocate a comparison and never skip a render.
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
