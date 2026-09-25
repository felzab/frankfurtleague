import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { setImmediate as settled } from "node:timers/promises";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLSaisonPhase } from "@/features/saisons/schemas.ts";
import type { AdminSpieltagEditRow } from "@/features/spieltage/types.ts";

const { calls } = doubleActions({
  modules: ["/src/features/spieltage/actions.ts"],
  answer: () => Promise.resolve({ success: true, message: "Der Spieltag wurde aktualisiert." }),
});

doubleToasts();

const { AdminSpieltagEditForm } = await import("./AdminSpieltagEditForm.tsx");

type User = ReturnType<typeof userEvent.setup>;

/** A season running through August alone, so both ends of its span stand in one month of the calendar. */
const SAISON_SPAN = { start: "2026-08-02", end: "2026-08-29" };

const ID = "68c1f0a2b3c4d5e6f7a8b9e0";

/** A matchday of `phase` under whatever label the page composed for it, dated inside the season. */
function spieltag(phase: FLSaisonPhase, label: string, overrides: Partial<AdminSpieltagEditRow> = {}): AdminSpieltagEditRow {
  return {
    id: ID,
    label,
    beginn: "2026-08-10",
    ende: "2026-08-10",
    anzahl_spiele: 1,
    saison_phase: phase,
    saison_id: "2026",
    position: 1,
    spieleAngelegt: 1,
    ...overrides,
  };
}

/** The editor as its page renders it, handing the case the unmount it closes with. */
const renderEditor = (row: AdminSpieltagEditRow): (() => void) =>
  render(
    underNext(h(AdminSpieltagEditForm, { spieltag: row, saisonSpan: SAISON_SPAN, pageHeader: { title: row.label } }), {
      search: "saison_id=2026",
    }),
  ).unmount;

/** The labels of the date pickers the editor renders, in their order. */
const pickers = (): string[] =>
  screen
    .getAllByRole("spinbutton", { name: /^Tag, / })
    .map((segment) => (segment.getAttribute("aria-labelledby") ?? "").split(" ").at(-1) ?? "")
    .map((labelId) => document.getElementById(labelId)?.textContent ?? "");

/** One arrow-key step on a picker's day segment, which is how a reader moves the date without the calendar. */
async function stepDay(user: User, picker: string, key: "ArrowUp" | "ArrowDown"): Promise<void> {
  const day = screen.getByRole("spinbutton", { name: `Tag, ${picker}` });
  await act(async () => day.focus());
  await user.keyboard(`{${key}}`);
}

/** The save pressed, and the dialog it may raise confirmed, so what is judged is the payload the action was sent. */
async function save(user: User): Promise<unknown[]> {
  await user.click(screen.getByRole("button", { name: "Speichern" }));
  await act(async () => settled());
  const confirm = screen.queryByRole("button", { name: "Trotzdem speichern" });
  if (confirm !== null) {
    await user.click(confirm);
    await act(async () => settled());
  }

  return calls.filter((call) => call.action === "patchSpieltagAction").map((call) => call.payload);
}

/** The rail's change list, opened, as its rows read. */
async function changeList(user: User): Promise<string[]> {
  await user.click(screen.getByRole("button", { name: /Änderungen/ }));

  return screen.getAllByRole("listitem").map((row) => row.textContent);
}

/** One day of the open calendar, found by the date its cell announces. */
const dayCell = (day: number): HTMLElement =>
  screen
    .getAllByRole("button")
    .find((cell) => new RegExp(`, ${String(day)}\\. August 2026(,|$| )`).test(cell.getAttribute("aria-label") ?? "")) ??
  assert.fail(`the open calendar shows no ${String(day)}. August`);

const isOffered = (cell: HTMLElement): boolean => cell.getAttribute("aria-disabled") !== "true";

beforeEach(() => {
  calls.length = 0;
});

describe("the one date a final's Spieltag is given", () => {
  /* `spieltagLabels` composes the rendered name from the phase and `position`, so a form choosing on
     it would follow a string the page makes rather than the row's own state. The labels here are
     chosen so that the name and the phase disagree. */
  it("dates a final once and every other matchday twice, on the stored phase rather than the label", () => {
    let unmount = renderEditor(spieltag("finale", "Endspiel"));
    assert.deepEqual(pickers(), ["Datum"], "a final's matchday is asked for two dates");
    unmount();

    unmount = renderEditor(spieltag("halbfinale", "Finale"));
    assert.deepEqual(pickers(), ["Beginn", "Ende"], "a Halbfinale named „Finale“ is asked for one date");
    unmount();
  });

  /* The picked day reaches `ende` in the draft rather than at the save, so the endpoint is sent the
     pair it declares from either panel and no later step learns which one built it. */
  it("sends the pair the endpoint takes from either panel", async () => {
    const user = userEvent.setup();
    let unmount = renderEditor(spieltag("finale", "Endspiel"));
    await stepDay(user, "Datum", "ArrowUp");
    assert.deepEqual(
      await save(user),
      [{ id: ID, beginn: "2026-08-11", ende: "2026-08-11" }],
      "the one picked day is not both ends of the span",
    );
    unmount();

    calls.length = 0;
    unmount = renderEditor(spieltag("halbfinale", "Halbfinale", { ende: "2026-08-12" }));
    await stepDay(user, "Ende", "ArrowUp");
    assert.deepEqual(await save(user), [{ id: ID, beginn: "2026-08-10", ende: "2026-08-13" }]);
    unmount();
  });

  /* A change list still describing two fields would name a picker that is not on screen and count one
     picked day as two changes, which is also what `ConfirmDiscardModal` offers to throw away. */
  it("lists one picked day as one change, under the picker's own label", async () => {
    const user = userEvent.setup();
    const unmount = renderEditor(spieltag("finale", "Endspiel"));
    await stepDay(user, "Datum", "ArrowUp");

    const rows = await changeList(user);
    assert.equal(rows.length, 1, `one picked day is listed as ${String(rows.length)} changes: ${rows.join(" | ")}`);
    assert.match(rows[0] ?? "", /^Datum:/);
    unmount();
  });

  /* `fl_backend/app/core/domain.py :: UNENFORCED` names this page as where a matchday off its implied
     count is seen at all, and only the editor page's own fixture read fills the number it is seen by. */
  it("reports the count gap from the row's own fixture count", () => {
    const unmount = renderEditor(spieltag("halbfinale", "Halbfinale", { anzahl_spiele: 2, spieleAngelegt: 1 }));

    assert.ok(screen.queryAllByText("Es fehlen noch Spiele").length > 0, "a matchday short of its fixtures says nothing");
    assert.ok(screen.queryAllByText("Angelegt: 1. Erwartet: 2.").length > 0, "the gap is reported without the counts it is read against");
    unmount();
  });
});

describe("what bounds the Zeitraum pickers", () => {
  /* The season is the only bound the pickers take, and that is a decision: `REQ-DATE-008` judges the
     STEP, so a static one would grey out a repair the endpoint allows. The greying is the calendar's
     own answer and carries no sentence beside it (`docs/frontend/spec.md` §1.12, diagnostic 4). */
  it("greys out every day outside the season in both pickers, and no day inside it", async () => {
    const user = userEvent.setup();
    const unmount = renderEditor(spieltag("halbfinale", "Halbfinale", { ende: "2026-08-12" }));

    const triggers = screen.getAllByRole("button", { name: /^Kalender/ });
    assert.equal(triggers.length, 2, "the span editor offers other than one calendar per picker");

    for (const [which, trigger] of triggers.entries()) {
      await user.click(trigger);

      assert.equal(isOffered(dayCell(1)), false, `picker ${String(which + 1)} offers the day before the season`);
      assert.equal(isOffered(dayCell(2)), true, `picker ${String(which + 1)} greys out the season's first day`);
      assert.equal(isOffered(dayCell(29)), true, `picker ${String(which + 1)} greys out the season's last day`);
      assert.equal(isOffered(dayCell(30)), false, `picker ${String(which + 1)} offers the day after the season`);

      await user.keyboard("{Escape}");
    }
    unmount();
  });

  /* The schema is built per instance from the editor's own span: an absent span is legal
     (`fl_frontend/src/features/spieltage/schemas.test.ts`), so a schema built from none refuses nothing. */
  it("refuses a day moved out of the season on the field that holds it", async () => {
    const user = userEvent.setup();
    const unmount = renderEditor(spieltag("halbfinale", "Halbfinale", { beginn: "2026-08-02", ende: "2026-08-12" }));

    await stepDay(user, "Beginn", "ArrowDown");

    assert.ok(screen.queryAllByText("Wähle einen Tag innerhalb der Saison.").length > 0, "a day before the season is taken without a word");
    unmount();
  });
});
