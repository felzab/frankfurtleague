"use client";

import { areaBoundary } from "@/features/dashboard/components/providers/areaBoundary";

import { PERSON_SHELL_CRASH, personStructureFor } from "../../constants";
import { PersonShell } from "../ui/PersonShell";

import type { ReactNode } from "react";

function PersonCrashShell({ children }: { children: ReactNode }) {
  return (
    // The landing alone, which every person holds, and no switcher: which other pages the person
    // holds is what the failing read would have said, so no address is called missing either.
    <PersonShell
      structure={personStructureFor(new Set(["landing"]))}
      orte={[]}
      fallback={PERSON_SHELL_CRASH}>
      {children}
    </PersonShell>
  );
}

export const PersonAreaBoundary = areaBoundary(PersonCrashShell);
