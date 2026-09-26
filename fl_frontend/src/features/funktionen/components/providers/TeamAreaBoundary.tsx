"use client";

import { catchError } from "next/error";
import { useParams } from "next/navigation";

import { DashboardErrorBoundary } from "@/features/dashboard/components/ui/DashboardErrorBoundary";
import { asCaughtError } from "@/shared/utils/caughtError";

import { TeamShell } from "../ui/TeamShell";

import type { ErrorInfo } from "next/error";

/** `PersonAreaBoundary`'s answer for the team area (`docs/frontend/spec.md :: I385`). */
function TeamAreaFallback(_props: object, { error, reset }: ErrorInfo) {
  // Off the address, since the layout that reads its params is what failed.
  const { team_id, saison_id } = useParams<{ team_id: string; saison_id: string }>();

  return (
    // No entry and no season chip: which seats the person holds here is what the failing read would have said.
    <TeamShell
      teamId={team_id}
      saisonId={saison_id}
      structure={[]}
      saison={null}>
      <DashboardErrorBoundary
        error={asCaughtError(error)}
        reset={reset}
      />
    </TeamShell>
  );
}

export const TeamAreaBoundary = catchError(TeamAreaFallback);
