"use client";

import { DashboardShell } from "../ui/DashboardShell";
import { areaBoundary } from "./areaBoundary";

import type { ReactNode } from "react";

/** The dashboard layout's failing read is the season slot's, its list cold and the backend unreached. */
function DashboardCrashShell({ children }: { children: ReactNode }) {
  // No season slot: that read is what failed.
  return <DashboardShell saisonMetadataDisplay={null}>{children}</DashboardShell>;
}

export const DashboardAreaBoundary = areaBoundary(DashboardCrashShell);
