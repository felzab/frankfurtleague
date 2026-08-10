"use client";

import { createContext, useContext } from "react";

import type { FLSpielDraftStatus, FLSpielFieldStatus } from "@/features/spiele/draftStatus";
import type { ReactNode } from "react";

/**
 * Carries `deriveSpielDraftStatus`'s answer to every field of the editor.
 *
 * **A context rather than props, and the reason is the alternative.** Fifteen fields live in four
 * sections nested two deep; threading the status down as props means every section forwarding a value
 * it does not read, and a future field arriving in a new section means editing three components before
 * it can show a marker. The provider is rendered by the form that owns the draft, so there is exactly
 * one producer and the direction of flow is unchanged.
 *
 * Scoped to this folder on purpose. It is not a slice-wide context: nothing outside the editor has a
 * draft to describe.
 */
const DraftStatusContext = createContext<FLSpielDraftStatus | undefined>(undefined);

export function DraftStatusProvider({ status, children }: { status: FLSpielDraftStatus; children: ReactNode }) {
  // No `useMemo`: the status object is rebuilt on every render by design — the draft it describes is
  // too — so memoising the provider value would allocate a comparison and never skip a render.
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
 * One field's status by its payload path.
 *
 * Returns `undefined` for a path with no descriptor rather than throwing, and that is deliberate: a
 * field whose marker is silently absent is a smaller failure than a page that will not render, and the
 * `draftStatus` test suite already asserts that every field of the draft shape has a row.
 */
export function useFieldStatus(path: string): FLSpielFieldStatus | undefined {
  return useDraftStatus().byPath.get(path);
}
