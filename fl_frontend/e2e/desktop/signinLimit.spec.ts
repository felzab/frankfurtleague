/**
 * E2E · the edge's limit on code requests, met as a visitor meets it: one address asking for code
 * after code is refused, with the sign-in's own toast. Desktop alone: the limit is the edge's, and
 * every browser meets the same answer to the same request.
 */
import { expect } from "@playwright/test";

import { test } from "../support/journey";
import { codeStep, pressSend } from "../support/signIn";

/** An address no record of the made-up league holds, so no request here files a mail. */
const STRANGER = "niemand@example.com";

test("one address asking for code after code is refused", async ({ page }) => {
  const step = codeStep(page);
  const refusal = page
    .getByRole("alertdialog", { name: "Code nicht gesendet" })
    .filter({ hasText: "Zu viele Versuche in kurzer Zeit. Warte einen Moment und versuche es dann erneut." });

  // `nginx/shared/site.conf`'s sign-in zone, five a minute with a burst of three and no delay: four
  // requests at once pass, and each one more needs twelve seconds since the first that this one
  // address has not had.
  for (let request = 1; request <= 4; request += 1) {
    await pressSend(page, STRANGER);
    await expect(step, `request ${String(request)} of the burst`).toBeVisible();
  }

  // The fifth is refused unless twelve seconds have passed since the first, and then the sixth is,
  // unless twenty-four have: either way, a visitor asking this fast is turned away.
  await pressSend(page, STRANGER);
  await expect(step.or(refusal)).toBeVisible();
  if (await step.isVisible()) {
    await pressSend(page, STRANGER);
    await expect(refusal).toBeVisible();
  }
});
