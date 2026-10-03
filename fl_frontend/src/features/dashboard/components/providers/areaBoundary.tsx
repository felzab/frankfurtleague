"use client";

import { catchError } from "next/error";

import { asCaughtError } from "@/shared/utils/caughtError";

import { DashboardErrorBoundary } from "../ui/DashboardErrorBoundary";

import type { ErrorInfo } from "next/error";
import type { ComponentType, ReactNode } from "react";

/**
 * An area layout's own boundary, for a failing read the area's `error.tsx` cannot catch: Next nests
 * that one inside the layout. Answered inside the area's `Shell`, so sign-out stays in reach
 * (`docs/frontend/spec.md :: I385`).
 */
export function areaBoundary(Shell: ComponentType<{ children: ReactNode }>) {
  function AreaFallback(_props: object, { error, reset }: ErrorInfo) {
    return (
      <Shell>
        <DashboardErrorBoundary
          error={asCaughtError(error)}
          reset={reset}
        />
      </Shell>
    );
  }

  return catchError(AreaFallback);
}
