/**
 * E2E · J10, a club leaving mid-season, under each project: the administrator takes it out of the running season from
 * its editor's danger box, the opponent still to play it is told at that write, and the act is gone from the box, since
 * an Austritt is never lifted. A booked referee is told by the scheduler's close, so `firstPass.spec.ts` holds that. Each
 * project's own club (`departing`) leaves, on the session `support/administrator.setup.ts` saved.
 */
import { expect } from "@playwright/test";

import { typeInto } from "./support/application";
import { ADMINISTRATOR_STATE, test } from "./support/journey";
import { filedMessages, mailedMessage } from "./support/mailSink";

test.use({ storageState: ADMINISTRATOR_STATE });

/** The running season of the made-up seed. */
const SAISON = "2027";

/** The Trainer of the one opponent holding a contact (`scripts/ops/seed/seed.js`). */
const OPPONENT = "berta.birkner@example.com";

test("a club leaves the season, and its opponent is told at once", async ({ page, departing: { club, fixture } }) => {
  await page.goto(`/admin/saisons/${SAISON}/teams`);
  await page.getByRole("main").getByRole("link", { name: club }).click();
  await expect(page.getByRole("banner").getByRole("heading", { level: 1, name: club })).toBeVisible();

  // The dialog opens on a withdrawal from today: the reason is what it cannot know.
  const before = await filedMessages();
  await page.getByRole("main").getByRole("button", { name: "Entfernen" }).click();
  const dialog = page.getByRole("dialog", { name: "Aus der Saison nehmen" });
  await typeInto(dialog.getByRole("textbox", { name: /^Grund/ }), "Das Team tritt nicht mehr an.");
  await dialog.getByRole("button", { name: "Entfernen" }).click();
  await expect(dialog).toBeHidden();

  // The club reads as gone, and no act on the page could bring it back.
  await expect(page.getByRole("banner").getByText("Zurückgezogen", { exact: true })).toBeVisible();
  await expect(page.getByRole("main").getByRole("button", { name: "Entfernen" })).toHaveCount(0);

  // The opponent's notice names the fixture still open between the two.
  const notice = await mailedMessage(OPPONENT, `${club} spielt nicht mehr mit`, before);
  expect(notice.join("\n"), "the fixture the opponent is told of").toContain(fixture);
});
