/**
 * E2E · the `test` every journey imports: Playwright's own, with the options a project sets.
 *
 * An option rather than a constant per file, so one journey runs under both projects as each
 * project's own person (https://playwright.dev/docs/test-parameterize#parameterized-projects).
 */
import { test as base } from "@playwright/test";

export type JourneyOptions = {
  /** The project's own administrator, granted by `scripts/ops/seed/seed.js`: no two projects share a passkey. */
  administrator: string;
};

export const test = base.extend<JourneyOptions>({
  // Empty until a project sets it, which `fl_frontend/playwright.config.ts` does for each.
  administrator: ["", { option: true }],
});
