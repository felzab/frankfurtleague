"use client";

import { createContext, useContext } from "react";

import type { FLSaisonDraftStatus, FLSaisonFieldStatus } from "@/features/saisons/saisonDraftStatus";
import type { ReactNode } from "react";

/** Folder-scoped: nothing outside this editor has a season draft to describe. */
const SaisonDraftStatusContext = createContext<FLSaisonDraftStatus | undefined>(undefined);

export function SaisonDraftStatusProvider({ status, children }: { status: FLSaisonDraftStatus; children: ReactNode }) {
  // No `useMemo`: the status object is rebuilt every render by design, so memoising would allocate a
  // comparison and never skip a render.
  return <SaisonDraftStatusContext.Provider value={status}>{children}</SaisonDraftStatusContext.Provider>;
}

export function useSaisonDraftStatus(): FLSaisonDraftStatus {
  const status = useContext(SaisonDraftStatusContext);
  if (status === undefined) {
    throw new Error("useSaisonDraftStatus must be used within a SaisonDraftStatusProvider");
  }
  return status;
}

export function useSaisonFieldStatus(path: string): FLSaisonFieldStatus | undefined {
  return useSaisonDraftStatus().byPath.get(path);
}
