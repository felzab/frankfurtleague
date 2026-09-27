"use client";

import { useParams } from "next/navigation";

import { areaBoundary } from "@/features/dashboard/components/providers/areaBoundary";

import { TeamShell } from "../ui/TeamShell";

import type { ReactNode } from "react";

function TeamCrashShell({ children }: { children: ReactNode }) {
  // Off the address, since the layout that reads its params is what failed.
  const { team_id, saison_id } = useParams<{ team_id: string; saison_id: string }>();

  return (
    // No entry, no season chip and no switcher: which seats the person holds here is what the failing read would have said.
    <TeamShell
      teamId={team_id}
      saisonId={saison_id}
      structure={[]}
      saison={null}
      isRefused={false}
      orte={[]}>
      {children}
    </TeamShell>
  );
}

export const TeamAreaBoundary = areaBoundary(TeamCrashShell);
