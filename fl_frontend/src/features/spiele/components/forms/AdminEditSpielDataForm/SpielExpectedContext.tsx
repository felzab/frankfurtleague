"use client";

import { createContext, useContext } from "react";

import type { FLSpielExpectedField } from "@/features/spiele/draftStatus";
import type { ReactNode } from "react";

/**
 * **Disjoint from the shared `DraftStatusContext.tsx`, never a second copy of it**: what a fixture is
 * still waiting on is the match editor's alone, so it travels on its own context and the two are read
 * side by side by whoever needs both.
 */
const SpielExpectedContext = createContext<readonly FLSpielExpectedField[] | undefined>(undefined);

export function SpielExpectedProvider({ expected, children }: { expected: readonly FLSpielExpectedField[]; children: ReactNode }) {
  // No `useMemo`: the list is rebuilt every render by design, as the draft it describes is.
  return <SpielExpectedContext.Provider value={expected}>{children}</SpielExpectedContext.Provider>;
}

/** In descriptor order, which is the order `SpielRail`'s open-items list reads them in. */
export function useSpielExpected(): readonly FLSpielExpectedField[] {
  const expected = useContext(SpielExpectedContext);
  if (expected === undefined) {
    throw new Error("useSpielExpected must be used within a SpielExpectedProvider");
  }
  return expected;
}

/**
 * A scan and not a map: only a field whose descriptor names an `expectedWhen` can appear, so the list
 * is at most eight rows long and building an index per render would cost more than reading it.
 */
export function useSpielExpectedField(path: string): FLSpielExpectedField | undefined {
  return useSpielExpected().find((field) => field.path === path);
}
