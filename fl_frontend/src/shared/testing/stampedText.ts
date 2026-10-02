/**
 * A stamped sentence as a reader meets it, filled by the rule
 * `fl_frontend/src/features/bewerbungen/components/views/BestaetigungPanels.tsx :: Gefuellt` keeps: a
 * slot `slots` names no value for stands as written, so a comparison fails where the page left one.
 */
export function filledSlots(text: string, slots: Readonly<Record<string, string>>): string {
  return text.replace(/\{(\w+)\}/g, (slot, name: string) => slots[name] ?? slot);
}
