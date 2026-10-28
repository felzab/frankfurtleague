/**
 * E2E · the `test` every journey imports: Playwright's own, with the options a project sets and the
 * address each journey visits from.
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

type JourneyFixtures = {
  /** The address this journey visits from, which the stack's edge reads as the visitor's. */
  visitor: string;
};

/**
 * The addresses one worker hands out, each to one journey. A worker replacing a failed one has the
 * next `workerIndex` and so the next block, never an address a journey before it spent.
 */
const ADDRESSES_PER_WORKER = 16;

/** The journeys this worker has started. */
let started = 0;

export const test = base.extend<JourneyFixtures & JourneyOptions>({
  // Empty until a project sets them, which `fl_frontend/playwright.config.ts` does for each.
  administrator: ["", { option: true }],
  person: ["", { option: true }],

  // Each journey is one visitor, as each person on the site is: the edge's rate limits are per visitor,
  // and every journey shares one address with the others unless it names its own
  // (`nginx/e2e/e2e.conf`). Per journey rather than per project, so no journey spends another's
  // budget. RFC 5737's documentation range, which no real visitor holds.

  // On the stack's own requests alone, as Cloudflare sets it in production: `extraHTTPHeaders` would
  // carry it to challenges.cloudflare.com too, which answers a request naming its own header with 403,
  // and the sign-in's bot check never loads (https://playwright.dev/docs/network#modify-requests).
  // `provide` is the fixture's `use`, named apart from React's hook, which a lint rule reads it as.
  visitor: [
    async ({ context, baseURL }, provide, testInfo) => {
      if (started === ADDRESSES_PER_WORKER)
        throw new Error(`a worker has ${String(ADDRESSES_PER_WORKER)} visitor addresses, and every one is spent`);
      const address = `198.51.100.${String(1 + ((testInfo.workerIndex * ADDRESSES_PER_WORKER + started) % 254))}`;
      started += 1;

      await context.route(`${String(baseURL)}/**`, (route) =>
        route.continue({ headers: { ...route.request().headers(), "cf-connecting-ip": address } }),
      );
      await provide(address);
    },
    { auto: true },
  ],
});
