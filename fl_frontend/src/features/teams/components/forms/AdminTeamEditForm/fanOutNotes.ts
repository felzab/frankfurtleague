/**
 * The save toast's fixtures line — one half of `PATCH /teams/{team_id}`'s silent fan-out. The zero
 * names the scope, because the matches of a closed season keep the copy they were played under.
 */
export function describeSpieleFanOut(count: number): string {
  if (count === 0) return "In den laufenden und geplanten Saisons wurden Name und Kürzel an keinem Spiel geändert.";
  if (count === 1) return "Name und Kürzel wurden in 1 Spiel nachgezogen.";
  return `Name und Kürzel wurden in ${count} Spielen nachgezogen.`;
}

/**
 * The junction's line, never folded into the one above. Its zero names the scope because a club with
 * no junction row reaches it too — the state a failed entry leaves, and the one being repaired.
 */
export function describeSaisonTeamsFanOut(count: number): string {
  if (count === 0) return "Kein Eintrag in einer laufenden oder geplanten Saison wurde geändert; nur dort werden Name und Kürzel nachgezogen.";
  if (count === 1) return "1 Saison trägt den neuen Namen und das neue Kürzel.";
  return `${count} Saisons tragen den neuen Namen und das neue Kürzel.`;
}
