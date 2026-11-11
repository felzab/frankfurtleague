/**
 * E2E · the site's controls as a person works them, one way each, whatever page holds them.
 */
import { expect } from "@playwright/test";

import type { Locator, Page } from "@playwright/test";

/**
 * Types into a box, tapped first as a person reaches it: once the page's code runs, React hydrates what a press lands
 * on during the press itself (https://github.com/reactwg/react-18/discussions/37), so a press after it finds its
 * handler. Before that, text in the box is the browser's until the box replays it on hydrating
 * (`fl_frontend/src/kit/useEarlyEdit.ts`), and React replays a press held with it (`fl_frontend/src/kit/HeldForm.tsx`).
 */
export async function typeInto(box: Locator, value: string): Promise<void> {
  await box.click();
  await box.fill(value);
}

/**
 * Opens the select `label` names inside `scope` and presses `option`, which its list shows in a pop-over of the page's. A
 * select's button is named by its value, then its label (`useSelect`), so only a select holding no value starts on its label.
 */
export async function choose(page: Page, scope: Locator, label: RegExp, option: string | RegExp): Promise<void> {
  await scope.getByRole("button", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/**
 * Presses a row's act by its name, as a person finds it: the row's own button where the row shows one, else the row's
 * „Mehr“ and then the menu's entry of that name. A row's acts have these two homes by their list, at every width: a
 * decision and a list's one side act are buttons, and the side acts of a list whose rows carry two or more stand in
 * each row's one „⋯“. It fails where the row shows neither.
 */
export async function pressRowAct(row: Locator, name: string): Promise<void> {
  const button = row.getByRole("button", { name, exact: true });
  const more = row.getByRole("button", { name: "Mehr", exact: true });
  await expect(button.or(more)).toBeVisible();
  if (await button.isVisible()) {
    await button.click();
    return;
  }
  await more.click();
  await row.page().getByRole("menuitem", { name, exact: true }).click();
}

/** A page's box under `title`: a box carries its title as a heading, and no landmark. */
export function box(page: Page, title: string): Locator {
  return page.getByRole("main").locator("section", { has: page.getByRole("heading", { name: title, exact: true }) });
}

/**
 * The label holding a control of `role`, by the control's name where one is given. A radio or a tick is pressed on its
 * label, as a person presses it: React Aria clips the control's own input to nothing, so a press aimed at the input
 * lands on the label over it. `has` is queried inside each label, so its locator starts at the page, never at `scope`.
 */
export function labelOf(scope: Locator, role: "radio" | "checkbox", name?: string): Locator {
  return scope.locator("label").filter({ has: scope.page().getByRole(role, name === undefined ? {} : { name, exact: true }) });
}

/**
 * A row's chip by its words: a list with a „Stand“ column draws it after the row's name and in the column, and the
 * list's width shows one of the two.
 */
export function chip(row: Locator, words: string): Locator {
  return row.getByText(words, { exact: true }).filter({ visible: true });
}

/** An editor's save bar, a landmark of its own named by its act, so its lines are read inside it. */
export function saveBar(page: Page): Locator {
  return page.getByRole("region", { name: "Speichern" });
}

/** Presses the save bar's „Speichern“, as far as the bar saying it saved. */
export async function save(page: Page): Promise<void> {
  const bar = saveBar(page);
  await bar.getByRole("button", { name: "Speichern" }).click();
  await expect(bar.getByText("Gespeichert", { exact: true })).toBeVisible();
}
