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
 * A path its editor's descriptor table declares, the caller naming that table's union. Unnamed or
 * widened to `string`, the union accepts nothing, so a path no descriptor carries fails the
 * typecheck rather than rendering without its marker.
 */
export type FieldPath<P extends string> = string extends P ? never : NoInfer<P>;

/** `undefined` for a declared path whose descriptor does not apply to this draft. */
export function useFieldStatus<P extends string = never>(path: FieldPath<P>): FLFieldStatus<string> | undefined {
  return useDraftStatus().byPath.get(path);
}
