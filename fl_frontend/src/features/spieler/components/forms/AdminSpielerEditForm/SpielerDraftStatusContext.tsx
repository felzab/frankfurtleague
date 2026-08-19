"use client";

import { createContext, useContext } from "react";

import type { FLSpielerDraftStatus, FLSpielerFieldStatus } from "@/features/spieler/spielerDraftStatus";
import type { ReactNode } from "react";

/** Folder-scoped: nothing outside this editor has a player draft to describe. */
const SpielerDraftStatusContext = createContext<FLSpielerDraftStatus | undefined>(undefined);

export function SpielerDraftStatusProvider({ status, children }: { status: FLSpielerDraftStatus; children: ReactNode }) {
  // No `useMemo`: the status object is rebuilt every render by design, so memoising the value would
  // allocate a comparison and never skip a render.
  return <SpielerDraftStatusContext.Provider value={status}>{children}</SpielerDraftStatusContext.Provider>;
}

export function useSpielerDraftStatus(): FLSpielerDraftStatus {
  const status = useContext(SpielerDraftStatusContext);
  if (status === undefined) {
    throw new Error("useSpielerDraftStatus must be used within a SpielerDraftStatusProvider");
  }
  return status;
}

export function useSpielerFieldStatus(path: string): FLSpielerFieldStatus | undefined {
  return useSpielerDraftStatus().byPath.get(path);
}
