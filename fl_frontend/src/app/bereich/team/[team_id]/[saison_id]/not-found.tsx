"use client";

import { useParams } from "next/navigation";

import { teamHref } from "@/features/funktionen/teamSeats";
import { ShellNotFound } from "@/shared/components/ui/ShellNotFound";

// At the team area's root so a notFound() renders inside the team shell: the next boundary up is the
// public one, which answers a signed-in person with the visitor's navigation and footer.
export default function TeamNotFound() {
  // The address's own team and season, since the landing a way out names is theirs.
  const { team_id, saison_id } = useParams<{ team_id: string; saison_id: string }>();

  return (
    <ShellNotFound
      message="Diese Seite gehört nicht zu Deinem Team, oder die Adresse stimmt nicht."
      href={teamHref(team_id, saison_id)}
      linkLabel="Zur Übersicht"
    />
  );
}
