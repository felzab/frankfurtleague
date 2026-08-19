"use client";

import { createContext, useContext } from "react";

import type { FLSchiedsrichterDraftStatus, FLSchiedsrichterFieldStatus } from "@/features/schiedsrichter/schiedsrichterDraftStatus";
import type { ReactNode } from "react";

const SchiedsrichterDraftStatusContext = createContext<FLSchiedsrichterDraftStatus | undefined>(undefined);

export function SchiedsrichterDraftStatusProvider({ status, children }: { status: FLSchiedsrichterDraftStatus; children: ReactNode }) {
  // No `useMemo`: the status object is rebuilt every render by design, so memoising the provider
  // value would allocate a comparison and never skip a render.
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
