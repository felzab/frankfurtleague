"use client";

import { createContext, useContext } from "react";

import type { FLDraftStatus, FLFieldStatus } from "@/shared/utils/draftStatus";
import type { ReactNode } from "react";

/**
 * **A context rather than props**: the fields sit two levels deep, so threading the status would
 * have every section forwarding a value it does not read. `string` for the group is what lets one
 * context serve every editor without a feature import.
 */
const DraftStatusContext = createContext<FLDraftStatus<string> | undefined>(undefined);

export function DraftStatusProvider({ status, children }: { status: FLDraftStatus<string>; children: ReactNode }) {
  // No `useMemo`: the status is rebuilt every render by design, as the draft it describes is.
  return <DraftStatusContext.Provider value={status}>{children}</DraftStatusContext.Provider>;
}

export function useDraftStatus(): FLDraftStatus<string> {
  const status = useContext(DraftStatusContext);
  if (status === undefined) {
    throw new Error("useDraftStatus must be used within a DraftStatusProvider");
  }
  return status;
}

/**
 * `undefined` rather than a throw for a path with no descriptor: a missing marker is a smaller
 * failure than a page that will not render. Nothing reports a mistyped path at runtime, so
 * `fieldLabelPaths.test.ts` sweeps every path a label is given.
 */
export function useFieldStatus(path: string): FLFieldStatus<string> | undefined {
  return useDraftStatus().byPath.get(path);
}
