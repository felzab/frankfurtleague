/**
 * FRONTEND · the end-to-end journeys: Playwright, against the end-to-end stack.
 *
 * Desktop journeys run in Chromium and phone-first journeys in WebKit under Playwright's own iPhone
 * profile, the browser an iPhone's engine is (https://playwright.dev/docs/emulation). Neither starts
 * a server: the stack is the production images behind nginx, raised on its own compose project with
 * the made-up seed by `./scripts/ops/local.sh --e2e` on a development machine and by the journeys'
 * CI job, and served at the one origin below.
 *
 * Invariants:
 * - One worker, the journeys in file order: every journey reads and writes the one seeded database
 *   and its one mail sink, so two at once would read each other's codes and records.
 * - No retry. A journey that passes on its second try failed on its first, and a retry would report
 *   that as green.
 * - Everything a run writes lands in `../.tmp-playwright/`, which `.gitignore` covers with every
 *   other `.tmp-*` directory, but for the administrator's session, which stays with the stack's keys
 *   (`e2e/support/journey.ts :: ADMINISTRATOR_STATE`).
 */
import { defineConfig, devices } from "@playwright/test";

import type { JourneyOptions } from "./e2e/support/journey";

/** The local `AUTH_URL` (`docker-compose.local.yml`), which is also the passkeys' relying party, `localhost`. */
const BASE_URL = "http://localhost:3000";

/**
 * The journeys every viewport runs, at the top of `e2e/`; each project's own directory holds the rest.
 *
 * The passkey ceremonies are desktop's alone. Playwright's WebKit has no WebAuthn of its own and
 * supplies `PublicKeyCredential` as a plain object, which `@simplewebauthn/browser`'s support check
 * refuses before any ceremony starts, so a phone passkey journey would test Playwright's stand-in
 * rather than WebKit. The phone follows an administrator's mailed code as far as the passkey card, and
 * reads the Verwaltung under the session the `administrator` project below sets up in Chromium.
 */
const EVERY_PROJECT = [
  "signin.spec.ts",
  "spielplan.spec.ts",
  "accountActs.spec.ts",
  "legal.spec.ts",
  "applicant.spec.ts",
  "austritt.spec.ts",
  "administration.spec.ts",
];

export default defineConfig<JourneyOptions>({
  testDir: "./e2e",
  outputDir: "../.tmp-playwright/results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // A `test.only` left in a commit would run one journey and pass the job.
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI
    ? [["github"], ["list"], ["html", { open: "never", outputFolder: "../.tmp-playwright/report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "../.tmp-playwright/report" }]],
  use: {
    baseURL: BASE_URL,
    // The league's own: dates, numbers and the sign-in's day are German whatever the machine's settings.
    locale: "de-DE",
    timezoneId: "Europe/Berlin",
    trace: "retain-on-failure",
  },
  projects: [
    // A setup project, as Playwright's guide names one (https://playwright.dev/docs/auth): every administration journey of
    // both projects reads the session it saves.
    {
      name: "administrator",
      testMatch: "support/administrator.setup.ts",
      use: devices["Desktop Chrome"],
    },
    {
      name: "desktop",
      dependencies: ["administrator"],
      testMatch: [...EVERY_PROJECT, "desktop/**/*.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        administrator: "admin.desktop@example.com",
        twoDevices: "frieda.falk@example.com",
        mover: "clara.kranz@example.com",
        leaver: "hanna.hahn@example.com",
        applicants: { accepted: "Zeder", declined: "Ahorn", objected: "Buche" },
        departing: { club: "Linde", fixture: "Birke vs. Linde" },
        entered: "Kastanie",
        squadded: "Jonas",
      },
    },
    {
      name: "phone",
      dependencies: ["administrator"],
      testMatch: [...EVERY_PROJECT, "phone/**/*.spec.ts"],
      // The profile `playwright open --mobile` takes in WebKit, Playwright's newest iPhone.
      use: {
        ...devices["iPhone 17"],
        administrator: "admin.telefon@example.com",
        twoDevices: "gustav.gerber@example.com",
        mover: "dora.dahl@example.com",
        leaver: "ingo.imhof@example.com",
        applicants: { accepted: "Pappel", declined: "Birke", objected: "Erle" },
        departing: { club: "Esche", fixture: "Esche vs. Birke" },
        entered: "Eiche",
        squadded: "Lena",
      },
    },
    // Behind both projects above, which outlast the minute from the frontend's boot to the scheduler's first pass: only
    // a whole run orders a journey behind that timer without raising a test's time budget.
    {
      name: "first-pass",
      dependencies: ["desktop", "phone"],
      testMatch: "firstPass.spec.ts",
      use: devices["Desktop Chrome"],
    },
  ],
});
