"use client";

import { areaBoundary } from "@/features/dashboard/components/providers/areaBoundary";

import { AdminShell } from "../ui/AdminShell";

import type { ReactNode } from "react";

/**
 * The admin layout's failing read is the session guard's or the season slot's. A throw in the switcher
 * is a defect: its lookup is the guard's memoised one, whose failure the guard redirects before the
 * switcher renders.
 */
function AdminCrashShell({ children }: { children: ReactNode }) {
  return (
    // No season slot and no switcher: either read may be what failed.
    <AdminShell
      saisonMetadataDisplay={null}
      funktionSwitcher={null}>
      {children}
    </AdminShell>
  );
}

export const AdminAreaBoundary = areaBoundary(AdminCrashShell);
