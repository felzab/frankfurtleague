"use client";

import { createContext, useContext } from "react";

import type { ReactNode } from "react";

type SidemenuState = { isDesktopCollapsed: boolean; onMobileClose: () => void };

/**
 * **A context rather than props**: a slot the shell is handed, `AppShell`'s `funktionSwitcher`, arrives
 * built by a layout that knows neither the rail's width nor the drawer, and may stream in under a guard.
 */
const SidemenuStateContext = createContext<SidemenuState | undefined>(undefined);

export function SidemenuStateProvider({ state, children }: { state: SidemenuState; children: ReactNode }) {
  return <SidemenuStateContext.Provider value={state}>{children}</SidemenuStateContext.Provider>;
}

export function useSidemenuState(): SidemenuState {
  const state = useContext(SidemenuStateContext);
  if (state === undefined) {
    throw new Error("useSidemenuState must be used within a Sidemenu");
  }
  return state;
}
