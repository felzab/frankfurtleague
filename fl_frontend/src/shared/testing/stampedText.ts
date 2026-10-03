/** A slot as a stamped sentence spells it. */
const SLOT = /\{(\w+)\}/g;

/**
 * Written apart from the page's reader (`fl_frontend/src/shared/utils/stampedSlots.ts :: stueckeVon`),
 * so a value that reader changes on its way to the page fails every comparison made against this.
 */
export function filledSlots(text: string, slots: Readonly<Record<string, string>>): string {
  return text.replace(SLOT, (slot, name: string) =>
    name === "datenschutz" ? "Datenschutzerklärung" : Object.hasOwn(slots, name) ? (slots[name] ?? slot) : slot,
  );
}
