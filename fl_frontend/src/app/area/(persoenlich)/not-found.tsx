"use client";

import { DEIN_BEREICH_TITEL } from "@/core/seitenNamen";
import { ShellNotFound } from "@/shared/components/ui/ShellNotFound";

// At the person area's root so a notFound() renders inside the person shell: the next boundary up is
// the root's, which draws no shell.
export default function PersoenlichNotFound() {
  return (
    <ShellNotFound
      message={`Diese Seite gehört nicht zu „${DEIN_BEREICH_TITEL}“, oder die Adresse stimmt nicht.`}
      href="/area"
      linkLabel={DEIN_BEREICH_TITEL}
    />
  );
}
