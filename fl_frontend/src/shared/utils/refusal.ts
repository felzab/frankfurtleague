/**
 * What a refusal carries, so a weak one cannot ship shorter than its own way out. The two sentences
 * are the FORM register `validation.ts :: VALIDATION_FAILED` declares, the action second.
 */
export type RefusalParts = {
  /** What did not happen, so the reader knows which state the record is left in. Never how it was detected. */
  reason: string;
  /**
   * The next thing the admin does, as an imperative. A pair where a separable verb closes the clause: German seats
   * `where` before that verb, and only the caller knows its own clause shape.
   */
  repair: string | { before: string; after: string };
  /** The panel or page holding the repair, named as its own heading reads. Omit it where the repair is here. */
  where?: string;
};

/**
 * One refusal from its parts. **`where` is framed here rather than at the call site**, so no caller
 * pairs an article with a heading — `DraftRail`'s `nomen` prop settles the same problem the same way.
 */
export function buildRefusal({ reason, repair, where }: RefusalParts): string {
  const { before, after } = typeof repair === "string" ? { before: repair, after: "" } : repair;
  const parts = where === undefined ? [before, after] : [before, `unter „${where}“`, after];

  // Joined off a filtered list, never a template: a repair with no tail would otherwise leave a double space or a
  // space before the period, and both survive every check the gate runs.
  return `${reason}. ${parts.filter((part) => part !== "").join(" ")}.`;
}

/**
 * The detail under a failure nothing can name a cause for. The way out alone, because every call
 * site raises it beneath a title already saying the save did not happen.
 */
export const UNKNOWN_REFUSAL = "Lade die Seite neu und versuche es erneut.";

// Every form meeting a refusal no input shows, with no sentence of its own, says this. Here rather than in
// the client hook raising it: a route handler receives a client module's exports as references, not strings.
/**
 * What it COST, never why the mechanism could not mark a control. The second half is the reassuring one: a reader
 * told a save failed wants to know whether the work is gone.
 */
export const UNHANDLED_FIELD_REFUSAL = buildRefusal({
  // Never `Ablehnung` — that is the triage's decline, and this fires on that page too. Never a reload: it would
  // discard the entries this sentence has just promised are intact.
  reason: "Nichts wurde gespeichert, aber Deine Eingaben stehen unverändert im Formular",
  repair: "Versuche es noch einmal",
});
