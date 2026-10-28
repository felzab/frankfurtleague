/**
 * E2E · the `test` every journey imports: Playwright's own, with the options a project sets.
 *
 * Options rather than constants per file, so one journey runs under both projects as each project's
 * own people (https://playwright.dev/docs/test-parameterize#parameterized-projects). Each is a
 * record of `scripts/ops/seed/seed.js`, and no two projects share one: a passkey or a code one
 * project made is never the other's to find.
 */
import { test as base } from "@playwright/test";

export type JourneyOptions = {
  /** An administrator's grant. */
  administrator: string;
  /** A referee's address, which admits a sign-in and grants no Verwaltung. */
  person: string;
};

export const test = base.extend<JourneyOptions>({
  // Empty until a project sets them, which `fl_frontend/playwright.config.ts` does for each.
  administrator: ["", { option: true }],
  person: ["", { option: true }],
});
