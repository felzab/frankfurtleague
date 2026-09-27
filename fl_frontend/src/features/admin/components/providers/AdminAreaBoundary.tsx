"use client";

import { areaBoundary } from "@/features/dashboard/components/providers/areaBoundary";

import { AdminShell } from "../ui/AdminShell";

import type { ReactNode } from "react";

/**
 * The admin layout's failing read is the session guard's, the season slot's, or a defect in the
 * switcher's, whose lookup answers its own failure.
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
