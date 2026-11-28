"use client";

import { createContext, useContext } from "react";

/** Whether the rail stands collapsed to its glyphs, and the toggle flipping it; `RailRoot` provides it. */
export const RailContext = createContext<{ collapsed: boolean; toggle: () => void } | null>(null);

/**
 * Whether the rail stands collapsed to its glyphs, and the toggle flipping it: read by the strip's toggle
 * and by a rail link's tooltip, which opens only while the link's words are clipped. `null` outside a rail
 * frame.
 */
export function useRail() {
  return useContext(RailContext);
}

/** Whether the rail stands collapsed, for a rail part whose menu then opens beside the rail; `false` outside a rail frame. */
export function useRailCollapsed() {
  return useRail()?.collapsed === true;
}
