"use client";

import { useParams } from "next/navigation";

import { areaBoundary } from "@/features/dashboard/components/providers/areaBoundary";

import { TEAM_SIDEMENU_STRUCTURE } from "../../constants";
import { TeamShell } from "../ui/TeamShell";

import type { ReactNode } from "react";

function TeamCrashShell({ children }: { children: ReactNode }) {
  // Off the address, since the layout that reads its params is what failed.
  const { team_id, saison_id } = useParams<{ team_id: string; saison_id: string }>();

  return (
    // Every entry, which no seat narrows, so a page is headed by its own name; no season chip and no
    // switcher: which seats the person holds here is what the failing read would have said.
    <TeamShell
      teamId={team_id}
      saisonId={saison_id}
      structure={TEAM_SIDEMENU_STRUCTURE}
      saison={null}
      isRefused={false}
      orte={[]}>
      {children}
    </TeamShell>
  );
}

export const TeamAreaBoundary = areaBoundary(TeamCrashShell);
