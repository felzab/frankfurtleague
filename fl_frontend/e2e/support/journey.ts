/**
 * E2E · the `test` every journey imports: Playwright's own, with the options a project sets.
 *
 * Options rather than constants per file, so one journey runs under both projects as each project's
 * own people (https://playwright.dev/docs/test-parameterize#parameterized-projects). Each is a
 * record of `scripts/ops/seed/seed.js`, and no two projects share one: a passkey or a code one
 * project made is never the other's to find.
 */
import path from "node:path";

import { test as base } from "@playwright/test";

import { standInForTurnstile } from "./turnstileStandIn";

import type { Page, Request } from "@playwright/test";

export type JourneyOptions = {
  /** An administrator's grant. */
  administrator: string;
  /** A referee's address the account acts sign in as on two devices, and then end the other device's session. */
  twoDevices: string;
  /** A referee's address the account acts move to a new mailbox. */
  mover: string;
  /** A referee's address the account acts delete. */
  leaver: string;
  /** The schools the applicant's journeys apply as, one per way an application ends. `declined` is a club the form lists. */
  applicants: { accepted: string; declined: string; objected: string };
  /** The club the Austritt takes out of the running season, and the fixture its one opponent with a contact is told of. */
  departing: { club: string; fixture: string };
  /**
   * The club the administration enters into the planned season, and the kit colour its editor saves. A season's colour
   * is one team's and both projects enter the one season, so each has its own, and neither is one `PLANNED_ROWS` of
   * `scripts/ops/seed/seed.js` holds nor the wish `application.ts :: apply` picks, which a colour given away would close.
   */
  entered: { club: string; colour: string };
  /** The pupil the administration edits in the running season's squads. */
  squadded: string;
  /**
   * A confirmed contact seat's address on a club of the running season, and what waits on it: the coming fixture whose
   * date it answers and whose line-up it owes, and the pupil whose confirmed registration it decides.
   */
  contact: { address: string; club: string; fixture: string; pupil: string };
  /** A club of the running season whose live registration link (`?token=…`) a pupil registers through, and the address of its confirmed contact seat, which admits them. */
  registering: { club: string; token: string; admitter: string };
  /** A confirmed referee's address, the played fixture whose report they owe, and the coming one whose booking they answer. */
  booked: { address: string; played: string; coming: string };
};

type JourneyFixtures = {
  /** The administrator's device, beside the one the journey's own person holds, already signed in. */
  administration: Page;
};

/**
 * The end-to-end stack's own folder, where it files the mail it does not send and keeps its keys: by default the one
 * in this checkout's root, which `./scripts/ops/local.sh --e2e` makes and `--e2e --down` deletes. `E2E_DIR` names
 * another checkout's, so a run from a worktree reads the stack its primary checkout started.
 */
export const E2E_DIR = path.resolve(process.env.E2E_DIR ?? path.join(__dirname, "..", "..", "..", ".tmp-e2e"));

/**
 * The session `./administrator.setup.ts` saves, which every administration journey opens with
 * (https://playwright.dev/docs/auth). Beside the stack's keys, which go when the stack goes and no failed run uploads:
 * it holds a live session of that stack.
 */
export const ADMINISTRATOR_STATE = path.join(E2E_DIR, "administrator.json");

/**
 * Waits for Next's prefetch of a match link of the made-up seed's running season, a request carrying the `_rsc`
 * search parameter. Next sends one, in production and once the link is in view, only after React has hydrated the
 * link (https://nextjs.org/docs/app/getting-started/linking-and-navigating#hydration-not-completed), and a full
 * document load of the same address never does, so the presses after it are client navigations, which the pop-up's
 * route intercepts, not full loads. Called before the load, so the prefetch cannot be missed.
 */
export function hydrated(page: Page): Promise<Request> {
  return page.waitForRequest((request) => {
    const url = new URL(request.url());
    return /^\/saisons\/2027\/spiele\/[0-9a-f]{24}$/.test(url.pathname) && url.searchParams.has("_rsc");
  });
}

export const test = base.extend<JourneyFixtures & JourneyOptions>({
  // Empty until a project sets them, which `fl_frontend/playwright.config.ts` does for each.
  administrator: ["", { option: true }],
  twoDevices: ["", { option: true }],
  mover: ["", { option: true }],
  leaver: ["", { option: true }],
  applicants: [{ accepted: "", declined: "", objected: "" }, { option: true }],
  departing: [{ club: "", fixture: "" }, { option: true }],
  entered: [{ club: "", colour: "" }, { option: true }],
  squadded: ["", { option: true }],
  contact: [{ address: "", club: "", fixture: "", pupil: "" }, { option: true }],
  registering: [{ club: "", token: "", admitter: "" }, { option: true }],
  booked: [{ address: "", played: "", coming: "" }, { option: true }],

  // The test's own context; a context a journey builds beside it takes the stand-in itself. `provide` is the
  // fixture's `use`, named apart from React's hook, which a lint rule reads it as.
  context: async ({ context }, provide) => {
    await standInForTurnstile(context);
    await provide(context);
  },

  // A second context as a fixture, as Playwright's guide builds one for a second role
  // (https://playwright.dev/docs/auth#testing-multiple-roles-with-pom-fixtures).
  administration: async ({ browser }, provide) => {
    const device = await browser.newContext({ storageState: ADMINISTRATOR_STATE });
    await standInForTurnstile(device);
    await provide(await device.newPage());
    await device.close();
  },
});
