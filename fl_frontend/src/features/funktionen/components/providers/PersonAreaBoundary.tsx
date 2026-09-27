"use client";

import { areaBoundary } from "@/features/dashboard/components/providers/areaBoundary";

import { PersonShell } from "../ui/PersonShell";

import type { ReactNode } from "react";

function PersonCrashShell({ children }: { children: ReactNode }) {
  return (
    // No entry and no switcher: which pages the person holds is what the failing read would have said.
    <PersonShell
      structure={[]}
      orte={[]}>
      {children}
    </PersonShell>
  );
}

export const PersonAreaBoundary = areaBoundary(PersonCrashShell);
