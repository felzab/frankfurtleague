import assert from "node:assert/strict";

import { JSDOM } from "jsdom";

/**
 * The words of every result panel in a link page's markup, in page order. A panel is
 * `fl_frontend/src/features/bewerbungen/components/views/BestaetigungPanels.tsx :: BestaetigungErgebnis`'s
 * status section, each one an outcome a screen reader announces.
 */
export function resultPanels(html: string): string[] {
  return [...JSDOM.fragment(html).querySelectorAll('section[role="status"]')].map((panel) => collapsed(panel.textContent ?? ""));
}

/**
 * Holds one state of a link page to exactly one result panel, its own: two tell the reader two
 * outcomes. `own` is a sentence or pattern that panel holds, or `null` for a state its form answers.
 */
export function assertOwnPanel(html: string, own: string | RegExp | null, state: string): void {
  const panels = resultPanels(html);

  if (own === null) {
    assert.deepEqual(panels, [], `${state} shows a result panel beside its form`);
    return;
  }
  assert.equal(panels.length, 1, `${state} shows ${String(panels.length)} result panels, not its own alone: ${panels.join(" | ")}`);
  const [panel = ""] = panels;
  assert.ok(typeof own === "string" ? panel.includes(collapsed(own)) : own.test(panel), `${state}'s one result panel is not its own: ${panel}`);
}

const collapsed = (text: string): string => text.replace(/\s+/g, " ").trim();
