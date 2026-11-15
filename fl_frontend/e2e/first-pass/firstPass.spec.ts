/**
 * E2E · what only the scheduler does, which no lower tier sees run in the built image: its first pass deletes J2's
 * application whose 14 days lapsed and tells its confirmed seat, tells J10's booked referee by closing a departed club's
 * fixture, and deletes J4's pupil a season past their last squad. The pass runs a minute after the frontend boots and the
 * next an hour later (`fl_frontend/src/instrumentationNode.ts`), so each case reads what the made-up seed left it, once:
 * the seed holds one of each.
 */
import { expect } from "@playwright/test";

import { chooseWho } from "../support/actionLog";
import { SAISON, SUBJECT } from "../support/application";
import { ADMINISTRATOR_STATE, test } from "../support/journey";
import { MAIL_WAIT_MS, mailedMessage } from "../support/mailSink";

test.use({ storageState: ADMINISTRATOR_STATE });

/**
 * The scheduler's own delay from the frontend's boot to its first pass, `fl_frontend/src/instrumentationNode.ts ::
 * FIRST_PASS_DELAY_MS`, spelled again here: that module is the server's boot hook, which a journey does not load.
 */
const FIRST_PASS_DELAY_MS = 60 * 1000;

/** The first pass's notice may take the delay, then as long as any sent mail is waited for. */
const FIRST_PASS_WAIT_MS = FIRST_PASS_DELAY_MS + MAIL_WAIT_MS;

/** Whatever the sink holds: the pass filed it before any journey here could take a reading. */
const SINCE_THE_START = new Set<string>();

/** The referee the pass tells, and the start of the notice's subject. */
const REFEREE = "ben.brandt@example.com";
const NOTICE = "Nicht mehr eingeteilt: Spiel am";

// Each case waits for the pass itself, whichever project ran before it. The referee's notice comes of the job after those
// that delete (`fl_frontend/src/instrumentationNode.ts :: loadJobs`), so every deletion stands once it is filed. The
// test's own budget grows by the wait, so the wait ends first and reports what it waited for.
test.beforeEach(async ({}, testInfo) => {
  testInfo.setTimeout(testInfo.timeout + FIRST_PASS_WAIT_MS);
  await mailedMessage(REFEREE, NOTICE, SINCE_THE_START, { timeout: FIRST_PASS_WAIT_MS });
});

test("an application whose 14 days lapsed is deleted, and the seat that confirmed told", async ({ page }) => {
  await mailedMessage("lea.lehmann@example.com", SUBJECT.deleted, SINCE_THE_START);

  await page.goto(`/admin/saisons/${SAISON}/bewerbungen`);
  // A row the pass leaves first: a list not yet drawn holds no Lärche either.
  await expect(page.getByRole("main").getByRole("link", { name: "Espe", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Lärche", exact: true })).toHaveCount(0);
});

test("the referee booked on a departed club's fixture is told", async () => {
  const notice = await mailedMessage(REFEREE, NOTICE, SINCE_THE_START);

  expect(notice.join("\n"), "the fixture the referee no longer whistles").toContain("Esche vs. Weide");
});

test("each deletion the pass made stands in the Protokoll, counted and naming nobody", async ({ page }) => {
  await page.goto("/admin/log");
  const main = page.getByRole("main");
  await chooseWho(page, main, "Automatisch");

  const rows = main.getByRole("row");
  await expect(rows.filter({ hasText: "Nach Frist gelöscht · Bewerbungen: 1" })).toBeVisible();
  await expect(rows.filter({ hasText: "Nach Frist gelöscht · Spieler: 1" })).toBeVisible();
});
