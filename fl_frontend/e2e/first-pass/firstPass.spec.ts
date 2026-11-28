/**
 * E2E · what only the scheduler does, which no lower tier sees run in the built image: its first pass deletes the
 * planned season's application whose 14 days lapsed and tells its one confirmed seat, tells the referee booked on a
 * disqualified club's fixture still to play that the booking is lifted, and deletes a pupil in no squad since the
 * finished season. The pass runs a minute after the frontend boots and the next an hour later, so the case reads what
 * the made-up seed left it, once: the seed holds one of each.
 */
import { expect } from "@playwright/test";

import { chooseWho } from "../support/actionLog";
import { SUBJECT } from "../support/application";
import { ADMINISTRATOR_STATE, test } from "../support/journey";
import { PEOPLE, PLANNED } from "../support/madeUpLeague";
import { MAIL_WAIT_MS, mailedMessage } from "../support/mailSink";

test.use({ storageState: ADMINISTRATOR_STATE });

/**
 * The scheduler's own delay from the frontend's boot to its first pass, spelled again here under the scheduler's name
 * for it: its module is server code, which a journey does not load.
 */
const FIRST_PASS_DELAY_MS = 60 * 1000;

/** The first pass's notice may take the delay, then as long as any sent mail is waited for. */
const FIRST_PASS_WAIT_MS = FIRST_PASS_DELAY_MS + MAIL_WAIT_MS;

/** Whatever the sink holds: the pass filed it before any journey here could take a reading. */
const SINCE_THE_START = new Set<string>();

/** The referee the pass tells, and the start of the notice's subject. */
const REFEREE = PEOPLE.firstPass.referee.address;
const NOTICE = "Nicht mehr eingeteilt: Spiel am";

test("the first pass deletes what lapsed, tells whom it owes, and logs each deletion", async ({ page }, testInfo) => {
  // The pass itself, whichever project ran before it. The referee's notice comes of the job after those that delete, so
  // every deletion stands once it is filed. The test's own budget grows by the wait, so the wait ends first and reports
  // what it waited for.
  testInfo.setTimeout(testInfo.timeout + FIRST_PASS_WAIT_MS);
  const notice = await mailedMessage(REFEREE, NOTICE, SINCE_THE_START, { timeout: FIRST_PASS_WAIT_MS });

  await test.step("an application whose 14 days lapsed is deleted, and the seat that confirmed told", async () => {
    await mailedMessage(PEOPLE.firstPass.erased.address, SUBJECT.deleted, SINCE_THE_START);

    await page.goto(`/admin/saisons/${PLANNED}/bewerbungen`);
    // A row the pass leaves first: a list not yet drawn holds no lapsed one either.
    await expect(page.getByRole("main").getByRole("link", { name: PEOPLE.firstPass.applications.left, exact: true })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: PEOPLE.firstPass.applications.lapsed, exact: true })).toHaveCount(0);
  });

  await test.step("the referee booked on a departed club's fixture is told", () => {
    expect(notice.join("\n"), "the fixture the referee no longer whistles").toContain(PEOPLE.firstPass.lifted);
  });

  await test.step("each deletion the pass made stands in the Protokoll, counted and naming nobody", async () => {
    await page.goto("/admin/log");
    const main = page.getByRole("main");
    await chooseWho(page, main, "Automatisch");

    const rows = main.getByRole("row");
    await expect(rows.filter({ hasText: "Nach Frist gelöscht · Bewerbungen: 1" })).toBeVisible();
    await expect(rows.filter({ hasText: "Nach Frist gelöscht · Spieler: 1" })).toBeVisible();
  });
});
