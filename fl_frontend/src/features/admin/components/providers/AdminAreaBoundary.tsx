"use client";

import { catchError } from "next/error";

import { DashboardErrorBoundary } from "@/features/dashboard/components/ui/DashboardErrorBoundary";
import { asCaughtError } from "@/shared/utils/caughtError";

import { AdminShell } from "../ui/AdminShell";

import type { ErrorInfo } from "next/error";

/**
 * A failing read in the admin layout — the session guard's, the season slot's, or a defect in the
 * switcher's, whose lookup answers its own failure — which `fl_frontend/src/app/bereich/admin/error.tsx`
 * cannot catch: Next nests it inside the layout (`docs/frontend/spec.md :: I385`).
 */
function AdminAreaFallback(_props: object, { error, reset }: ErrorInfo) {
  return (
    // No season slot and no switcher: either read may be what failed.
    <AdminShell
      saisonMetadataDisplay={null}
      funktionSwitcher={null}>
      <DashboardErrorBoundary
        error={asCaughtError(error)}
        reset={reset}
      />
    </AdminShell>
  );
}

export const AdminAreaBoundary = catchError(AdminAreaFallback);
