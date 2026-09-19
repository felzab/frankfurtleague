"use client";

import { ShellNotFound } from "@/shared/components/ui/ShellNotFound";

// Scoped to `/admin` so a notFound() renders inside the admin shell: the next boundary up is the
// public one, which answers an administrator with the visitor's navigation and footer.
export default function AdminNotFound() {
  return (
    <ShellNotFound
      message="Diesen Eintrag gibt es nicht, oder die Adresse stimmt nicht."
      href="/admin"
      linkLabel="Zur Verwaltung"
    />
  );
}
