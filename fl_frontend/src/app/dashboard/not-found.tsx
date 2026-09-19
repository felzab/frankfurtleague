"use client";

import { ShellNotFound } from "@/shared/components/ui/ShellNotFound";

// At `dashboard/` rather than in a route group below it: a boundary inside a group answers that
// group alone, and every other dashboard route would fall through to the root one, under the
// visitor's chrome.
export default function DashboardNotFound() {
  return (
    <ShellNotFound
      message="Diese Seite gehört nicht zur gewählten Saison, oder die Adresse stimmt nicht."
      href="/dashboard"
      linkLabel="Zur Saisonübersicht"
    />
  );
}
