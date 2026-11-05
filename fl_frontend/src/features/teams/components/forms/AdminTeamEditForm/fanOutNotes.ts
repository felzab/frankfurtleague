/**
 * The save toast's line for `PATCH /teams/{team_id}`'s silent fan-out to the season rows, which every fixture of the
 * season reads its sides' names from. Its zero names the scope because a club with no junction row reaches it too —
 * the state a failed entry leaves, and the one being repaired.
 */
export function describeSaisonTeamsFanOut(count: number): string {
  if (count === 0) return "Kein Eintrag in einer laufenden oder geplanten Saison wurde geändert. Nur dort werden Name und Kürzel nachgezogen.";
  if (count === 1) return "1 Saison trägt den neuen Namen und das neue Kürzel.";
  return `${count} Saisons tragen den neuen Namen und das neue Kürzel.`;
}
