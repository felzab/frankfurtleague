import { stueckeVon } from "@/shared/utils/stampedSlots";

/**
 * A stamped sentence as a reader meets it, filled by the pieces
 * `fl_frontend/src/features/bewerbungen/components/views/BestaetigungPanels.tsx :: Gefuellt` renders:
 * a slot `slots` names no value for stands as written, so a comparison fails where the page left one.
 */
export function filledSlots(text: string, slots: Readonly<Record<string, string>>): string {
  return stueckeVon(text, slots)
    .map((stueck) => stueck.worte)
    .join("");
}
