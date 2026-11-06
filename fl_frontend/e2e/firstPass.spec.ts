/**
 * E2E · what only the scheduler does, read after its first pass: J2's application whose 14 days lapsed, deleted with its
 * Ansprechperson told, and J10's booked referee, told by the close of a departed club's fixture. The pass runs a minute
 * after the frontend boots and the next an hour later (`fl_frontend/src/instrumentationNode.ts`), so a journey sees only
 * what the made-up seed left it. This file's project runs after every other (`fl_frontend/playwright.config.ts`), past
 * that minute, once: the seed holds one of each.
 */
import { expect } from "@playwright/test";

import { SAISON, SUBJECT } from "./support/application";
import { ADMINISTRATOR_STATE, test } from "./support/journey";
import { mailedMessage } from "./support/mailSink";

test.use({ storageState: ADMINISTRATOR_STATE });

/** Whatever the sink holds: the pass filed it before any journey here could take a reading. */
const SINCE_THE_START = new Set<string>();

test("an application whose 14 days lapsed is deleted, and its Ansprechperson told", async ({ page }) => {
  await mailedMessage("ansprechperson.laerche@example.com", SUBJECT.deleted, SINCE_THE_START);

  await page.goto(`/admin/saisons/${SAISON}/bewerbungen`);
  // A row the pass leaves first: the list's placeholder holds no Lärche either.
  await expect(page.getByRole("main").getByRole("link", { name: "Espe", exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("link", { name: "Lärche", exact: true })).toHaveCount(0);
});

test("the referee booked on a departed club's fixture is told", async () => {
  const notice = await mailedMessage("ben.brandt@example.com", "Nicht mehr eingeteilt: Spiel am", SINCE_THE_START);

  expect(notice.join("\n"), "the fixture the referee no longer whistles").toContain("Esche vs. Weide");
});
