"use client";

import { createContext, useContext } from "react";

import type { FLSaisonDraftStatus, FLSaisonFieldStatus } from "@/features/saisons/saisonDraftStatus";
import type { ReactNode } from "react";

/**
 * Carries `deriveSaisonDraftStatus`'s answer to every field of the season editor — the same shape the
 * squad editor's `SpielerDraftStatusContext` carries for its own draft, and folder-scoped for the same
 * reason: nothing outside this editor has a season draft to describe.
 */
const SaisonDraftStatusContext = createContext<FLSaisonDraftStatus | undefined>(undefined);

export function SaisonDraftStatusProvider({ status, children }: { status: FLSaisonDraftStatus; children: ReactNode }) {
  // No `useMemo`: the status object is rebuilt on every render by design — the draft it describes is
  // too — so memoising the provider value would allocate a comparison and never skip a render.
  return <SaisonDraftStatusContext.Provider value={status}>{children}</SaisonDraftStatusContext.Provider>;
}

/** The whole picture, for the rail and the action bar. */
export function useSaisonDraftStatus(): FLSaisonDraftStatus {
  const status = useContext(SaisonDraftStatusContext);
  if (status === undefined) {
    throw new Error("useSaisonDraftStatus must be used within a SaisonDraftStatusProvider");
  }
  return status;
}

/** One field's status by its payload path; `undefined` for a path with no descriptor. */
export function useSaisonFieldStatus(path: string): FLSaisonFieldStatus | undefined {
  return useSaisonDraftStatus().byPath.get(path);
}
