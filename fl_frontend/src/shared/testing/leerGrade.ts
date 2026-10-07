import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";

/* After the harness above, which is what lets a `.tsx` module resolve (`docs/frontend/spec.md` §1.9). */
const { LEER_CLASSES } = await import("@/shared/components/ui/Angabe.tsx");

/**
 * The one empty-value grade on a rendered element: its words alone pass with the same text at the
 * value's own ink, so a site dropping `Leer` would go unnoticed.
 */
export function assertLeer(element: Element | null | undefined, wort: string): void {
  assert.ok(element, `nothing renders „${wort}“`);
  assert.equal(element.className, LEER_CLASSES, `„${wort}“ is not in the empty-value grade: ${element.className}`);
}

/** The same, over static markup: `wort` as markup spells it, so an `&` arrives as `&amp;`. */
export function assertLeerMarkup(html: string, wort: string): void {
  assert.ok(html.includes(`<span class="${LEER_CLASSES}">${wort}</span>`), `„${wort}“ is not in the empty-value grade`);
}
