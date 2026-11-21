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

import { nameOf, PEOPLE } from "./e2e/support/madeUpLeague";

import type { JourneyOptions } from "./e2e/support/journey";

/** The end-to-end stack's `AUTH_URL`, whose host is also the passkeys' relying party. */
const BASE_URL = "http://localhost:3000";

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

/** What a project's journeys type into the forms themselves: a new school, and the kit colour the editor saves. */
type Typed = { accepted: string; colour: string };

/**
 * A project's options: its people, clubs, fixtures and link as the seed writes them, beside what its journeys type. The
 * seat journey's school is the desktop project's alone, as that journey is.
 */
function optionsOf(project: typeof PEOPLE.projects.desktop, { accepted, colour }: Typed): Omit<JourneyOptions, "objected"> {
  return {
    administrator: project.administrator,
    twoDevices: project.twoDevices.address,
    mover: project.mover.address,
    leaver: project.leaver.address,
    applicants: { accepted, declined: project.applicants.declined },
    departing: project.departing,
    entered: { team: project.entered.team, colour },
    kaderPupil: project.kaderPupil,
    contact: {
      address: project.contact.trainer.address,
      team: project.contact.team,
      fixture: project.contact.fixture,
      pupil: nameOf(project.contact.pupil),
    },
    registering: { team: project.registering.team, token: project.registering.token, admitter: project.registering.admitter.address },
    booked: { address: project.booked.referee.address, played: project.booked.played, coming: project.booked.coming },
  };
}

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
        ...optionsOf(PEOPLE.projects.desktop, { accepted: "Zeder", colour: "Grau" }),
        objected: "Buche",
      },
    },
    {
      name: "phone",
      dependencies: ["administrator"],
      testMatch: [EVERY_PROJECT, "phone/**/*.spec.ts"],
      // The profile `playwright open --mobile` takes in WebKit, Playwright's newest iPhone.
      use: {
        ...devices["iPhone 17"],
        // Playwright starts Windows WebKit without accelerated compositing, under which a view transition crashes it.
        launchOptions: { ignoreDefaultArgs: ["--disable-accelerated-compositing"] },
        ...optionsOf(PEOPLE.projects.phone, { accepted: "Tanne", colour: "Bordeaux" }),
      },
    },
    // Its cases wait for the scheduler's first pass themselves, so CI's desktop leg runs it beside `desktop`.
    {
      name: "first-pass",
      dependencies: ["administrator"],
      testMatch: "first-pass/**/*.spec.ts",
      use: devices["Desktop Chrome"],
    },
  ],
});
