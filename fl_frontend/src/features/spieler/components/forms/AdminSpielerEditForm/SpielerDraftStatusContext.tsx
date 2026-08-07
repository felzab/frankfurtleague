"use client";

import { createContext, useContext } from "react";

import type { FLSpielerDraftStatus, FLSpielerFieldStatus } from "@/features/spieler/spielerDraftStatus";
import type { ReactNode } from "react";

/**
 * Carries `deriveSpielerDraftStatus`'s answer to every field of the squad editor — the same shape the
 * club editor's `TeamDraftStatusContext` carries for its own draft, and folder-scoped for the same
 * reason: nothing outside this editor has a player draft to describe.
 */
const SpielerDraftStatusContext = createContext<FLSpielerDraftStatus | undefined>(undefined);

export function SpielerDraftStatusProvider({ status, children }: { status: FLSpielerDraftStatus; children: ReactNode }) {
  // No `useMemo`: the status object is rebuilt on every render by design — the draft it describes is
  // too — so memoising the provider value would allocate a comparison and never skip a render.
  return <SpielerDraftStatusContext.Provider value={status}>{children}</SpielerDraftStatusContext.Provider>;
}

/** The whole picture, for the rail and the action bar. */
export function useSpielerDraftStatus(): FLSpielerDraftStatus {
  const status = useContext(SpielerDraftStatusContext);
  if (status === undefined) {
    throw new Error("useSpielerDraftStatus must be used within a SpielerDraftStatusProvider");
  }
  return status;
}

/** One field's status by its payload path; `undefined` for a path with no descriptor. */
export function useSpielerFieldStatus(path: string): FLSpielerFieldStatus | undefined {
  return useSpielerDraftStatus().byPath.get(path);
}
