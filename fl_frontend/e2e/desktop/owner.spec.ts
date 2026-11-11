/**
 * E2E · J7, the owner's way on Administratoren: a handover the seed left waiting is stopped, an administrator is added
 * and stopped, and the role is handed over, each act behind the owner's real touch, every wait's person told. The owner
 * holds one grant and one passkey, and a wait's end can only be seeded, so this is one journey: the promotion itself is
 * the scheduler's pass, which a journey cannot time. The handover it starts stays waiting: a visitor's `authapi` zone
 * (`nginx/shared/site.conf`) takes the sign-in's two landings, the enrolment's two requests and two for each touch, which
 * at a script's pace holds four touches and refuses a fifth. Desktop alone, for the reason
 * `fl_frontend/playwright.config.ts` gives at its projects.
 */
import { expect } from "@playwright/test";

import { chooseWho } from "../support/actionLog";
import { chip, choose, typeInto } from "../support/controls";
import { test } from "../support/journey";
import { filedMessages, mailedMessage } from "../support/mailSink";
import { assertionsSigned, enrolPasskey, signInWithCode } from "../support/signIn";

import type { Locator, Page } from "@playwright/test";

/** The one owner (`scripts/ops/seed/seed.js`), whom no other journey signs in as. */
const OWNER = "inhaber@example.com";

/** The administrator the seed's handover names, and the one this journey hands over to again. */
const SUCCESSOR = "admin.nachfolge@example.com";

/** An address no record holds: an addition is stopped before it holds anything. */
const ADDED = "admin.neu@example.com";

/** A waiting row of „Angekündigt“, by what waits and on whose address. */
const waitingRow = (page: Page, kind: string, address: string): Locator =>
  page.getByRole("main").getByRole("row").filter({ hasText: address }).filter({ hasText: kind });

/** „Zurückziehen“ on a waiting row, asked once and then touched. The open question hides the rows, so its close comes first. */
async function stop(page: Page, row: Locator): Promise<void> {
  await row.getByRole("button", { name: "Zurückziehen" }).click();
  const question = page.getByRole("alertdialog");
  await question.getByRole("button", { name: "Zurückziehen" }).click();
  await expect(question).toBeHidden();
  await expect(row).toHaveCount(0);
}

test("the owner stops what waits, adds an administrator and stops it, and hands over", async ({ page, context }) => {
  await signInWithCode(page, OWNER);
  await enrolPasskey(page, context);
  const touches = await assertionsSigned(context);

  await page.goto("/admin/administrators");
  await page
    .getByRole("main")
    .getByRole("button", { name: /^Angekündigt/ })
    .click();

  // What the seed left waiting: a handover, which locks a second one, and a holder's own change, the owner's alone to see.
  const seeded = waitingRow(page, "Übergabe der Leitung", SUCCESSOR);
  await expect(seeded).toBeVisible();
  await expect(waitingRow(page, "Neue E-Mail-Adresse", "admin.umzug@example.com")).toBeVisible();
  const handOver = page.getByRole("button", { name: "Leitung übergeben" });
  await expect(handOver).toHaveAccessibleDescription("Übergabe läuft schon");
  await stop(page, seeded);

  // An addition: its person is told at the start and at the stop.
  const beforeTheAddition = await filedMessages();
  await page.getByRole("button", { name: "Administrator eintragen" }).click();
  const addition = page.getByRole("dialog", { name: "Administrator eintragen" });
  await typeInto(addition.getByRole("textbox", { name: /^E-Mail-Adresse/ }), ADDED);
  await addition.getByRole("button", { name: "Administrator eintragen" }).click();
  await expect(addition).toBeHidden();
  const added = waitingRow(page, "Neuer Administrator", ADDED);
  await expect(added).toBeVisible();
  await mailedMessage(ADDED, "Neuer Zugang zur Verwaltung", beforeTheAddition);

  const beforeItsStop = await filedMessages();
  await stop(page, added);
  await mailedMessage(ADDED, "Angekündigte Änderung zurückgezogen", beforeItsStop);

  // A handover to a current administrator, now that none waits.
  const beforeTheHandover = await filedMessages();
  await handOver.click();
  const handover = page.getByRole("dialog", { name: "Leitung übergeben" });
  await choose(page, handover, /^Neu/, SUCCESSOR);
  await handover.getByRole("button", { name: "Leitung übergeben" }).click();
  await expect(handover).toBeHidden();
  const started = waitingRow(page, "Übergabe der Leitung", SUCCESSOR);
  await expect(started).toBeVisible();
  await mailedMessage(SUCCESSOR, "Übergabe der Leitung angekündigt", beforeTheHandover);

  // Read back from the server: the role stayed, and every press above took its own touch.
  await page.reload();
  const ownerRow = page.getByRole("main").getByRole("row").filter({ hasText: OWNER });
  await expect(chip(ownerRow, "Leitung")).toBeVisible();
  expect(await assertionsSigned(context), "an act on Administratoren ran with no touch of its own").toBe(touches + 4);

  // The log names the owner by address, and the row by what it was about.
  await page.goto("/admin/log");
  await chooseWho(page, page.getByRole("main"), OWNER);
  const logged = page.getByRole("main").getByRole("row");
  await expect(logged.filter({ hasText: `Eintragung zurückgezogen · ${ADDED}` })).toBeVisible();
  await expect(logged.filter({ hasText: `Übergabe gestartet · ${SUCCESSOR}` })).toBeVisible();
});
