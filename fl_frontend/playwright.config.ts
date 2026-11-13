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

/**
 * The local `AUTH_URL` (`docker-compose.local.yml`), which is also the passkeys' relying party, `localhost`, unless
 * `E2E_BASE_URL` names the origin a stack serves at.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";

/**
 * The journeys every viewport runs: each spec at the top of `e2e/`, and each project's own folder holds the rest.
 * Playwright matches a string pattern against the whole path, any folders allowed before it, so `*.spec.ts` alone would
 * reach every folder below; the folder's name anchors it.
 *
 * The passkey ceremonies are desktop's alone. Playwright's WebKit has no WebAuthn of its own and
 * supplies `PublicKeyCredential` as a plain object, which `@simplewebauthn/browser`'s support check
 * refuses before any ceremony starts, so a phone passkey journey would test Playwright's stand-in
 * rather than WebKit. The phone follows an administrator's mailed code as far as the passkey card, and
 * reads the Verwaltung under the session the `administrator` project below sets up in Chromium.
 */
const EVERY_PROJECT = "e2e/*.spec.ts";

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
      testMatch: [EVERY_PROJECT, "desktop/**/*.spec.ts"],
      use: {
        ...devices["Desktop Chrome"],
        administrator: "admin.desktop@example.com",
        twoDevices: "frieda.falk@example.com",
        mover: "clara.kranz@example.com",
        leaver: "hanna.hahn@example.com",
        applicants: { accepted: "Zeder", declined: "Ahorn", objected: "Buche" },
        departing: { club: "Linde", fixture: "Birke vs. Linde" },
        entered: { club: "Kastanie", colour: "Grau" },
        squadded: "Jonas",
        contact: { address: "achim.aust@example.com", club: "Ahorn", fixture: "Ahorn vs. Eiche", pupil: "Hedda Holm" },
        registering: { club: "Kastanie", token: "made-up-kastanie-invitation", admitter: "katja.kraus@example.com" },
        booked: { address: "selma.seidel@example.com", played: "Eiche vs. Ulme", coming: "Ahorn vs. Eiche" },
      },
    },
    {
      name: "phone",
      dependencies: ["administrator"],
      testMatch: [EVERY_PROJECT, "phone/**/*.spec.ts"],
      // The profile `playwright open --mobile` takes in WebKit, Playwright's newest iPhone.
      use: {
        ...devices["iPhone 17"],
        administrator: "admin.telefon@example.com",
        twoDevices: "gustav.gerber@example.com",
        mover: "dora.dahl@example.com",
        leaver: "ingo.imhof@example.com",
        applicants: { accepted: "Tanne", declined: "Birke", objected: "Fichte" },
        departing: { club: "Esche", fixture: "Esche vs. Birke" },
        entered: { club: "Weide", colour: "Bordeaux" },
        squadded: "Lena",
        contact: { address: "uta.uhlig@example.com", club: "Ulme", fixture: "Ulme vs. Kastanie", pupil: "Juna Jost" },
        registering: { club: "Eiche", token: "made-up-eiche-invitation", admitter: "edgar.eckert@example.com" },
        booked: { address: "tobias.thiel@example.com", played: "Ulme vs. Ahorn", coming: "Ulme vs. Kastanie" },
      },
    },
    // Its cases wait for the scheduler's first pass themselves, so CI's desktop leg runs it beside `desktop`.
    {
      name: "first-pass",
      dependencies: ["administrator"],
      testMatch: "first-pass/**/*.spec.ts",
      use: devices["Desktop Chrome"],
    },
    // The sessions the layout guard reads a pupil's, a referee's and a team contact's pages under, each signed in once a run.
    {
      name: "layout-sessions",
      testMatch: "layout/sessions.setup.ts",
      use: devices["Desktop Chrome"],
    },
    // The layout-shift guard: Chromium at both of its widths, since WebKit reports no layout shift. CI runs it on stacks
    // of its own, since its landing's cases run again under each state the database is re-seeded in.
    {
      name: "layout",
      dependencies: ["administrator", "layout-sessions"],
      testMatch: "layout/**/*.spec.ts",
      use: {
        ...devices["Desktop Chrome"],
        // The track the root always keeps, as a desktop browser draws it: headless Chromium is launched with
        // `--hide-scrollbars`, which leaves a track of 0 px, and the launch option filters that one argument out.
        launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] },
      },
    },
  ],
});
