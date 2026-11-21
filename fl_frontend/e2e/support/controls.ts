/**
 * E2E · the site's controls as a person works them, one way each, whatever page holds them.
 */
import { expect } from "@playwright/test";

import type { Locator, Page } from "@playwright/test";

/**
 * Types into a box, tapped first as a person reaches it: once the page's code runs, React hydrates what a press lands
 * on during the press itself (https://github.com/reactwg/react-18/discussions/37), so a press after it finds its
 * handler. Before that, every kit field stands `inert`, which Playwright's click and fill wait out as they wait for
 * any control to be actionable.
 */
export async function typeInto(box: Locator, value: string): Promise<void> {
  await box.click();
  await box.fill(value);
}

/**
 * Waits until `overlay`, a dialog, a sheet or a pop-over React Aria draws, has entered, the one state a journey presses
 * inside one. A press on a control still moving fails Playwright's stability check, and its retry scrolls the control
 * into view: that carries a rising sheet back down its scroller, which React Aria's `Sheet` closes once the viewport has
 * lost it, and closes a combo box's list, which React Aria closes on a scroll. A finger scrolls nothing by pressing, so
 * no person meets either. Entered is all of:
 * - no `[data-entering]` on the overlay or an ancestor: React Aria's documented entry state, which its `ModalOverlay`,
 *   `Modal`, `Popover` and `Sheet` carry while their entry runs;
 * - any part of it in the viewport (Playwright's `toBeInViewport`): React Aria mounts an overlay a frame or two before
 *   its entry starts (`runAfterKeyboard` in its `Modal` and `Popover`), a bottom sheet still below the screen then, with
 *   no `[data-entering]` yet. Not the whole of it, since a tall form's dialog scrolls inside its box on a phone.
 */
async function settled(overlay: Locator): Promise<void> {
  await expect(overlay.and(overlay.page().locator(":not([data-entering], [data-entering] *)"))).toBeInViewport();
}

/**
 * Waits until `dialog` has entered and holds the focus, the dialog itself or a child of it, which React Aria moves there
 * once it has entered: a dialog's own focus waits for the overlay's entry (`UNSTABLE_deferUntilEntered`, which the kit's
 * sheet sets), but a child taking focus as it mounts takes it at once, as a menu does (`useMenuTrigger` hands it
 * `autoFocus`), so the focus alone never says the dialog has entered.
 */
async function entered(dialog: Locator): Promise<void> {
  await settled(dialog.and(dialog.page().locator(":focus-within")));
}

/**
 * A dialog named `name`, or the one dialog standing, once it has entered: a centred one, a phone's sheet, or a pop-over
 * React Aria makes a dialog. The locator returned is the dialog's alone, so it also says when the dialog has gone.
 */
export async function enteredDialog(page: Page, name?: string): Promise<Locator> {
  const dialog = page.getByRole("dialog", name === undefined ? {} : { name });
  await entered(dialog);
  return dialog;
}

/**
 * The question `name` asks before an act runs, once it has entered. A question is found by its name: the toast an act
 * answers in is an `alertdialog` too, though it never takes the focus.
 */
export async function enteredQuestion(page: Page, name: string): Promise<Locator> {
  const question = page.getByRole("alertdialog", { name });
  await entered(question);
  return question;
}

/** The toast an act answers with, by its title. It never takes the focus and is read where it stands, so it is no overlay to wait on. */
export function toast(page: Page, title: string): Locator {
  return page.getByRole("alertdialog", { name: title });
}

/** That no dialog stands on the page. */
export async function expectNoDialog(page: Page): Promise<void> {
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

/**
 * The options of the combo box's list standing open, those named `name` where it is given, once its pop-over has
 * entered. A combo box's pop-over is non-modal (React Aria's `ComboBox` sets `isNonModal`), so it is no dialog
 * (`Popover` makes only a modal one a dialog) and never takes the focus, which stays in the box: only its entry is
 * waited on.
 */
export async function comboOptions(page: Page, name?: string): Promise<Locator> {
  const list = page.getByRole("listbox");
  await settled(list);
  return list.getByRole("option", name === undefined ? {} : { name, exact: true });
}

/**
 * Opens the select `label` names inside `scope` and presses `option`, which its list shows in a pop-over of the page's,
 * as far as the pop-over gone: it lies over what stands under it until its exit has run, and a press covered by it would
 * be retried behind a scroll. A select's button is named by its value, then its label (`useSelect`), so only a select
 * holding no value starts on its label.
 */
export async function choose(page: Page, scope: Locator, label: RegExp, option: string | RegExp): Promise<void> {
  await scope.getByRole("button", { name: label }).click();
  const list = page.getByRole("dialog").filter({ has: page.getByRole("listbox") });
  await entered(list);
  await list.getByRole("option", { name: option, exact: true }).click();
  await expect(list).toBeHidden();
}

/**
 * Presses a row's act by its name, as a person finds it: the row's own button where the row shows one, else the row's
 * „Mehr“ and then the menu's entry of that name. A row's acts have these two homes: a decision's are buttons at every
 * width, and side acts are buttons where the list's box is 42 rem wide or more and each row's one „⋯“ where it is
 * narrower. It fails where the row shows neither.
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
  // The menu's dialog: a pop-over on desktop, a sheet on a phone.
  const page = row.page();
  const menu = page.getByRole("dialog").filter({ has: page.getByRole("menu") });
  await entered(menu);
  await menu.getByRole("menuitem", { name, exact: true }).click();
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

/**
 * Whether the document, or the box any table scrolls in, scrolls sideways, which no page may. The kit's `Table` stands
 * in a box of its own that scrolls sideways, so a name that stops wrapping widens that box's content and never the
 * document's.
 */
export function scrollsSideways(page: Page): Promise<boolean> {
  return page.evaluate(() =>
    [document.documentElement, ...Array.from(document.querySelectorAll("table"), (table) => table.parentElement)].some(
      (box) => box !== null && box.scrollWidth > box.clientWidth,
    ),
  );
}

/**
 * A fact's value: the definition after its term. ARIA prohibits naming a `term` or a `definition`, so neither is found by
 * a name; a screen reader reads the two in order.
 */
export function valueOf(scope: Locator, term: string): Locator {
  return scope
    .getByRole("term")
    .filter({ hasText: new RegExp(`^${term}$`) })
    .locator("xpath=following-sibling::dd[1]");
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
