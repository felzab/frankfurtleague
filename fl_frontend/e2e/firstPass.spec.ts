/**
 * E2E · what only the scheduler does, read after its first pass: J2's application whose 14 days lapsed, deleted with its
 * confirmed seat told, J10's booked referee, told by the close of a departed club's fixture, and J4's pupil a season past
 * their last squad. The pass runs a minute after the frontend boots and the next an hour later
 * (`fl_frontend/src/instrumentationNode.ts`), so a journey sees only what the made-up seed left it. This file's project
 * runs after every other (`fl_frontend/playwright.config.ts`), past that minute, once: the seed holds one of each.
 */
import { expect, test as sinkRead } from "@playwright/test";

import { SAISON, SUBJECT } from "./support/application";
import { ADMINISTRATOR_STATE, test } from "./support/journey";
import { mailedMessage } from "./support/mailSink";

test.use({ storageState: ADMINISTRATOR_STATE });

/** Whatever the sink holds: the pass filed it before any journey here could take a reading. */
const SINCE_THE_START = new Set<string>();

test("an application whose 14 days lapsed is deleted, and the seat that confirmed told", async ({ page }) => {
  await mailedMessage("lea.lehmann@example.com", SUBJECT.deleted, SINCE_THE_START);

  await page.goto(`/admin/saisons/${SAISON}/bewerbungen`);
  // A row the pass leaves first: the list's placeholder holds no Lärche either.
  await expect(page.getByRole("main").getByRole("link", { name: "Espe", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Lärche", exact: true })).toHaveCount(0);
});

// Playwright's own test: it reads the sink and opens no page, and a journey's `test` fails any journey the edge never saw.
sinkRead("the referee booked on a departed club's fixture is told", async () => {
  const notice = await mailedMessage("ben.brandt@example.com", "Nicht mehr eingeteilt: Spiel am", SINCE_THE_START);

  expect(notice.join("\n"), "the fixture the referee no longer whistles").toContain("Esche vs. Weide");
});

// Behind the two above: the pass runs its jobs in order (`fl_frontend/src/instrumentationNode.ts :: loadJobs`), and the
// referee's notice comes of the job after those that delete, so both rows stand once it is filed.
test("each deletion the pass made stands in the Protokoll, counted and naming nobody", async ({ page }) => {
  await page.goto("/admin/log?by=system");

  const rows = page.getByRole("main").getByRole("row");
  await expect(rows.filter({ hasText: "Nach Frist gelöscht · Bewerbungen: 1" })).toBeVisible();
  await expect(rows.filter({ hasText: "Nach Frist gelöscht · Spieler: 1" })).toBeVisible();
});
