import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { act, createElement as h, useEffect } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";

import type { TwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm.ts";
import type { ReactNode } from "react";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { ConfirmActionRow } = await import("./ConfirmActionRow.tsx");
const { ConfirmPressButton } = await import("./ConfirmPressButton.tsx");
const { ConfirmReveal } = await import("./ConfirmReveal.tsx");
const { ConfirmTypedName, useTypedNameConfirm } = await import("./ConfirmTypedName.tsx");

const RESTING = "Person löschen";
const ARMED = "Ja, Person endgültig löschen";

/** The control as the last committed render handed it, so a case can press it where the closed press would not let a person. */
let control: TwoPressConfirm | undefined;

/** A panel as an erasure spells one: the field inside the reveal, the press in the row, the closure on the press. */
function Panel({ accepted, write }: { accepted: readonly [string, ...string[]]; write: () => Promise<void> }): ReactNode {
  const { confirm, field, reason } = useTypedNameConfirm(accepted);
  useEffect(() => {
    control = confirm;
  });

  return h(
    "div",
    null,
    confirm.isConfirming && h(ConfirmReveal, null, h(ConfirmTypedName, { field })),
    h(ConfirmActionRow, {
      confirm,
      children: h(ConfirmPressButton, {
        confirm,
        reason,
        resting: RESTING,
        armed: ARMED,
        running: "Löscht...",
        icon: null,
        onPress: () => confirm.press(write),
      }),
    }),
  );
}

/** Armed by a person's press, with the field the arming mounted. */
async function armed(accepted: readonly [string, ...string[]], write: () => Promise<void> = () => Promise.resolve()) {
  const user = userEvent.setup();
  render(h(Panel, { accepted, write }));
  await user.click(screen.getByRole("button", { name: RESTING }));

  return { user, field: await screen.findByRole("textbox", { name: /^Gib zur Bestätigung/ }) };
}

describe("the typed confirmation", () => {
  /* The arming closes the press it was made from, so without the move the keyboard is left on the closed control,
     a tab stop away from the one thing it can do next. */
  it("takes the focus the arming press leaves", async () => {
    const { field } = await armed(["Ada Byron"]);

    // A boolean rather than the node: a failing assertion's report inspects a jsdom node's whole window.
    assert.ok(document.activeElement === field, "the arming left the focus off the field it asks to be typed into");
  });

  /* Drop the closure and the press stands open over an empty field; drop the fold and the name exactly as the page
     draws it, a decomposed umlaut and a run of spaces among it, keeps the press closed for good. */
  it("keeps the armed press closed until the name is typed as the page draws it", async (t) => {
    const write = mock.fn(() => Promise.resolve());
    /* The clock spelled here rather than through `pressTwice`, whose lookup of the armed press by its name alone
       meets two controls once the arming closes it: the press, inert, and the refusal laid over it. */
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const { user, field } = await armed(["Jo\u0308rg  Weiß"], write);

    assert.equal(
      screen.queryAllByRole("textbox", { name: "Gib zur Bestätigung „Jo\u0308rg Weiß“ ein" }).length,
      1,
      "the label names nothing to type",
    );
    closedControl(ARMED, "Gib zuerst „Jo\u0308rg Weiß“ ein.");
    await user.type(field, "  JÖRG wei");
    closedControl(ARMED, "Gib zuerst „Jo\u0308rg Weiß“ ein.");

    await user.type(field, "ß ");
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: ARMED }));

    assert.equal(write.mock.callCount(), 1, "the press the name opened sent nothing, or sent twice");
  });

  /* The guard behind the closure, for a press the closure missed: drop its armed half and a press reaching the
     control over a wrong name erases somebody nobody typed. */
  it("sends nothing on a name it does not accept, whatever reaches the press", async (t) => {
    const write = mock.fn(() => Promise.resolve());
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const { user, field } = await armed(["Ada Byron"], write);

    await user.type(field, "Ada Lovelace");
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    act(() => {
      control?.press(write);
    });

    assert.equal(write.mock.callCount(), 0, "a press over a name the field does not accept sent the write");
  });

  /* The write runs inside the two-press hook, so a second press before the render reporting it is refused there;
     a composition sending the write itself would send it twice. */
  it("inherits the hook's refusal of a press while the write flies", async (t) => {
    const write = mock.fn(() => new Promise<void>(() => undefined));
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const { user, field } = await armed(["Ada Byron"], write);

    await user.type(field, "Ada Byron");
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    // Both presses from one render, the second landing before React has reported the first one's write.
    act(() => {
      const confirming = control;
      confirming?.press(write);
      confirming?.press(write);
    });

    assert.equal(write.mock.callCount(), 1, "a press while the write flew sent it again");
  });

  /* One person's two records spell the name alike, and two people's differ: the label offers each name once and
     the press opens on any of them. */
  it("accepts any of several names, offering each once", async () => {
    const { user, field } = await armed(["Ada Byron", "ada  byron", "Ada Lovelace"]);

    assert.equal(
      screen.queryAllByRole("textbox", { name: "Gib zur Bestätigung „Ada Byron“ oder „Ada Lovelace“ ein" }).length,
      1,
      "the label offers a name twice, or misses one",
    );
    await user.type(field, "ada lovelace");

    assert.equal(screen.queryAllByRole("button", { name: ARMED, description: /./ }).length, 0, "the second name left the press closed");
  });

  /* A name kept from a cancelled arming would open the press the moment the alert stands again, a two-press
     control with nothing typed. */
  it("asks for the name afresh on every arming", async () => {
    const { user, field } = await armed(["Ada Byron"]);

    await user.type(field, "Ada Byron");
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    await user.click(screen.getByRole("button", { name: RESTING }));

    const again = await screen.findByRole("textbox", { name: /^Gib zur Bestätigung/ });
    assert.equal((again as HTMLInputElement).value, "", "the field kept the name typed before the cancel");
    closedControl(ARMED, "Gib zuerst „Ada Byron“ ein.");
  });
});
