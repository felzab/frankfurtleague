/**
 * E2E · the Protokoll narrowed as a person narrows it. An option's value in the page's address is opaque
 * (`fl_frontend/src/features/action-log/filters.ts :: optionId`), and a value the log does not hold reads the whole
 * list, so a journey chooses the option and never writes the address.
 */
import { expect } from "@playwright/test";

import { choose } from "./application";

import type { Locator, Page } from "@playwright/test";

/**
 * Chooses `who` on the „Wer“ select in `scope`, as far as the list read for it. The select shows what the page read from
 * its address, and the list comes of that read, so a list still standing from before the choice is never what is asserted.
 */
export async function chooseWho(page: Page, scope: Locator, who: string): Promise<void> {
  await choose(page, scope, /Wer$/, who);
  await expect(scope.getByRole("button", { name: `${who} Wer` })).toBeVisible();
  // The list lies over what stands under it until its exit has run, and Playwright retries a press it covers behind a scroll.
  await expect(page.getByRole("listbox")).toBeHidden();
}
