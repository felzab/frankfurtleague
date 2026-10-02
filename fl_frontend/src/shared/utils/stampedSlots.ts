export type Slots = Readonly<Record<string, string>>;

/** The one slot a page fills whatever its record holds: its words are the privacy link's own. */
export const DATENSCHUTZ_SLOT = "datenschutz";

/** The `{datenschutz}` slot's value, so the stored sentence and the rendered one read the same. */
const DATENSCHUTZ_TEXT = "Datenschutzerklärung";

/** Split on the slots themselves, so the capture group keeps each one as a piece of its own. */
const SLOT_TEILER = /(\{\w+\})/;

/** One piece of a stamped sentence: its words as a reader meets them, and the slot they filled, if any. */
export type Stueck = { readonly worte: string; readonly slot?: string };

/**
 * A stamped sentence cut into the pieces a page renders, every slot filled by the one rule both
 * `fl_frontend/src/features/bewerbungen/components/views/BestaetigungPanels.tsx :: Gefuellt` and the
 * suites' `fl_frontend/src/shared/testing/stampedText.ts :: filledSlots` read, so the two cannot part.
 */
export function stueckeVon(text: string, werte: Slots): Stueck[] {
  return text.split(SLOT_TEILER).map((stueck) => {
    const name = /^\{(\w+)\}$/.exec(stueck)?.[1];
    if (name === undefined) return { worte: stueck };

    // Own keys alone: `{constructor}` would otherwise read `Object.prototype`'s, and render a function.
    const wert = name === DATENSCHUTZ_SLOT ? DATENSCHUTZ_TEXT : Object.hasOwn(werte, name) ? werte[name] : undefined;

    // Standing as written rather than blanked: a sentence quietly missing its subject reads as
    // finished, and one still spelling `{rolle}` says which fact never arrived.
    return wert === undefined ? { worte: stueck } : { worte: wert, slot: name };
  });
}
