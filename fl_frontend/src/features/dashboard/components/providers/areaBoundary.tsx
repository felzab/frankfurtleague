"use client";

import { catchError } from "next/error";

import { DashboardErrorBoundary } from "../ui/DashboardErrorBoundary";

import type { ErrorInfo } from "next/error";
import type { ComponentType, ReactNode } from "react";

/**
 * An area layout's own boundary, for a failing read the area's `error.tsx` cannot catch: Next nests
 * that one inside the layout. Answered inside the area's `Shell`, so sign-out stays in reach.
 */
export function areaBoundary(Shell: ComponentType<{ children: ReactNode }>) {
  function AreaFallback(_props: object, { error, retry }: ErrorInfo) {
    return (
      <Shell>
        <DashboardErrorBoundary
          error={error}
          retry={retry}
        />
      </Shell>
    );
  }

  return catchError(AreaFallback);
}
