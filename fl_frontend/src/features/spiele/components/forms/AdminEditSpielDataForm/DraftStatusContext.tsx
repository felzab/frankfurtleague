"use client";

import { createContext, useContext } from "react";

import type { FLSpielDraftStatus, FLSpielFieldStatus } from "@/features/spiele/draftStatus";
import type { ReactNode } from "react";

/**
 * **A context rather than props**: the fields sit two levels deep, so threading the status would
 * have every section forwarding a value it does not read, and a new field would mean editing its
 * ancestors before it could show a marker.
 */
const DraftStatusContext = createContext<FLSpielDraftStatus | undefined>(undefined);

export function DraftStatusProvider({ status, children }: { status: FLSpielDraftStatus; children: ReactNode }) {
  // No `useMemo`: the status is rebuilt every render by design, as the draft it describes is.
  return <DraftStatusContext.Provider value={status}>{children}</DraftStatusContext.Provider>;
}

export function useDraftStatus(): FLSpielDraftStatus {
  const status = useContext(DraftStatusContext);
  if (status === undefined) {
    throw new Error("useDraftStatus must be used within a DraftStatusProvider");
  }
  return status;
}

/**
 * `undefined` rather than a throw for a path with no descriptor: a missing marker is a smaller
 * failure than a page that will not render, and the test suite already asserts every field has a row.
 */
export function useFieldStatus(path: string): FLSpielFieldStatus | undefined {
  return useDraftStatus().byPath.get(path);
}
