"use client";

import { ShellNotFound } from "@/shared/components/ui/ShellNotFound";

// At the person area's root so a notFound() renders inside the person shell: the next boundary up is
// the public one, which answers a signed-in person with the visitor's navigation and footer.
export default function PersoenlichNotFound() {
  return (
    <ShellNotFound
      message="Diese Seite gehört nicht zu Deinem Bereich, oder die Adresse stimmt nicht."
      href="/bereich"
      linkLabel="Zur Übersicht"
    />
  );
}
