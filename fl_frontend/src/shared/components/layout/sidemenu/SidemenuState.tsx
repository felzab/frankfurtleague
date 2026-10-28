"use client";

// Redesign: goes with its last importer; `kit/RailFrame` replaces it.
import { createContext, useContext } from "react";

import type { ReactNode } from "react";
import type { LinkPrefix } from "../shell/linkPrefix";

type SidemenuState = {
  isDesktopCollapsed: boolean;
  onMobileClose: () => void;
  linkPrefix: LinkPrefix;
  keepsSaisonQuery: boolean;
};

/**
 * **A context rather than props**: a slot the shell is handed, `AppShell`'s `funktionSwitcher` or `entries`,
 * arrives built by a layout that knows neither the rail's width, the drawer nor the area's prefix, and may
 * stream in under a session read.
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
