"use client";

import { createContext, useContext } from "react";

import type { FLSchiedsrichterDraftStatus, FLSchiedsrichterFieldStatus } from "@/features/schiedsrichter/schiedsrichterDraftStatus";
import type { ReactNode } from "react";

/**
 * Carries `deriveSchiedsrichterDraftStatus`'s answer to every field of the referee editor — the same
 * shape the club editor's `TeamDraftStatusContext` carries for its own draft, and folder-scoped for
 * the same reason: nothing outside this editor has a referee draft to describe.
 */
const SchiedsrichterDraftStatusContext = createContext<FLSchiedsrichterDraftStatus | undefined>(undefined);

export function SchiedsrichterDraftStatusProvider({ status, children }: { status: FLSchiedsrichterDraftStatus; children: ReactNode }) {
  // No `useMemo`: the status object is rebuilt on every render by design — the draft it describes is
  // too — so memoising the provider value would allocate a comparison and never skip a render.
  return <SchiedsrichterDraftStatusContext.Provider value={status}>{children}</SchiedsrichterDraftStatusContext.Provider>;
}

export function useSchiedsrichterDraftStatus(): FLSchiedsrichterDraftStatus {
  const status = useContext(SchiedsrichterDraftStatusContext);
  if (status === undefined) {
    throw new Error("useSchiedsrichterDraftStatus must be used within a SchiedsrichterDraftStatusProvider");
  }
  return status;
}

export function useSchiedsrichterFieldStatus(path: string): FLSchiedsrichterFieldStatus | undefined {
  return useSchiedsrichterDraftStatus().byPath.get(path);
}
