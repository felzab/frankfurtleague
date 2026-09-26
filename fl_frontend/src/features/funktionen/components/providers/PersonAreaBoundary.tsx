"use client";

import { catchError } from "next/error";

import { DashboardErrorBoundary } from "@/features/dashboard/components/ui/DashboardErrorBoundary";
import { asCaughtError } from "@/shared/utils/caughtError";

import { PersonShell } from "../ui/PersonShell";

import type { ErrorInfo } from "next/error";

/**
 * A failing read in the person layout, which the area's own `error.tsx` cannot catch: Next nests
 * that boundary inside the layout. Answered inside the shell, so sign-out stays in reach
 * (`docs/frontend/spec.md :: I385`).
 */
function PersonAreaFallback(_props: object, { error, reset }: ErrorInfo) {
  return (
    // No entry and no switcher: which pages the person holds is what the failing read would have said.
    <PersonShell
      structure={[]}
      orte={[]}>
      <DashboardErrorBoundary
        error={asCaughtError(error)}
        reset={reset}
      />
    </PersonShell>
  );
}

export const PersonAreaBoundary = catchError(PersonAreaFallback);
