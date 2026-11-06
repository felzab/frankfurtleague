"use client";

import { VERWALTUNG_TITEL } from "@/core/seitenNamen";
import { ShellNotFound } from "@/shared/components/ui/ShellNotFound";

// Scoped to `/area/admin` so a notFound() renders inside the admin shell: the next boundary up is the
// root's, which draws no shell.
export default function AdminNotFound() {
  return (
    <ShellNotFound
      message="Diesen Eintrag gibt es nicht, oder die Adresse stimmt nicht."
      href="/area/admin"
      linkLabel={VERWALTUNG_TITEL}
    />
  );
}
