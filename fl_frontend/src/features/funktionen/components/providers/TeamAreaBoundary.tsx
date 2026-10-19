"use client";

import { areaBoundary } from "@/features/dashboard/components/providers/areaBoundary";

import { TeamShell } from "../ui/TeamShell";

import type { ReactNode } from "react";

function TeamCrashShell({ children }: { children: ReactNode }) {
  return (
    // Every entry, which no seat narrows, so a page is headed by its own name; no season chip and no
    // switcher: which seats the person holds here is what the failing read would have said.
    <TeamShell
      saisonMetadataDisplay={null}
      funktionSwitcher={null}>
      {children}
    </TeamShell>
  );
}

export const TeamAreaBoundary = areaBoundary(TeamCrashShell);
