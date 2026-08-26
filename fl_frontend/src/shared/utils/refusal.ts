/**
 * What a refusal carries, so a weak one cannot ship shorter than its own way out. The two sentences
 * are the FORM register `adminMutation.ts :: VALIDATION_FAILED` declares, the action second.
 */
export type RefusalParts = {
  /** What did not happen, so the reader knows which state the record is left in. Never how it was detected. */
  reason: string;
  /** The next thing the admin does, as an imperative. */
  repair: string;
  /** The panel or page holding the repair, named as its own heading reads. Omit it where the repair is here. */
  where?: string;
};

/**
 * One refusal from its parts. **`where` is framed here rather than at the call site**, so no caller
 * pairs an article with a heading — `DraftRail`'s `nomen` prop settles the same problem the same way.
 */
export function buildRefusal({ reason, repair, where }: RefusalParts): string {
  return `${reason}. ${where === undefined ? repair : `${repair} unter „${where}“`}.`;
}

/**
 * The detail under a failure nothing can name a cause for. The way out alone, because every call
 * site raises it beneath a title already saying the save did not happen.
 */
export const UNKNOWN_REFUSAL = "Lade die Seite neu und versuche es erneut.";
