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
const { ConfirmTypedAddress, useTypedAddressConfirm } = await import("./ConfirmTypedAddress.tsx");

const RESTING = "Person löschen";
const ARMED = "Ja, Person endgültig löschen";

/** Capitals on both sides of the at sign, so a fold reaching one side alone shows. */
const ADDRESS = "Ada.Kowalski@Example.org";
const FEHLT = "Gib zuerst die Adresse ein.";

/** The control as the last committed render handed it, so a case can press it where the closed press would not let a person. */
let control: TwoPressConfirm | undefined;

/** A panel as an erasure spells one: the field inside the reveal, the press in the row, the closure on the press. */
function Panel({ write }: { write: () => Promise<void> }): ReactNode {
  const { confirm, field, reason } = useTypedAddressConfirm(ADDRESS);
  useEffect(() => {
    control = confirm;
  });

  return h(
    "div",
    null,
    confirm.isConfirming && h(ConfirmReveal, null, h(ConfirmTypedAddress, { field })),
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
async function armed(write: () => Promise<void> = () => Promise.resolve()) {
  const user = userEvent.setup();
  render(h(Panel, { write }));
  await user.click(screen.getByRole("button", { name: RESTING }));

  return { user, field: await screen.findByRole("textbox", { name: `Gib zur Bestätigung die Adresse „${ADDRESS}“ ein` }) };
}

/** Whether the armed press is open: closed, it stands disabled under a refusal taking its name. */
const isOpen = (): boolean => {
  const presses = screen.queryAllByRole("button", { name: ARMED });

  return presses.length === 1 && !(presses[0] as HTMLButtonElement).disabled;
};

describe("the typed confirmation", () => {
  /* The arming closes the press it was made from, so without the move the keyboard is left on the closed control,
     a tab stop away from the one thing it can do next. */
  it("takes the focus the arming press leaves", async () => {
    const { field } = await armed();

    // A boolean rather than the node: a failing assertion's report inspects a jsdom node's whole window.
    assert.ok(document.activeElement === field, "the arming left the focus off the field it asks to be typed into");
  });

  /* Drop the closure and the press stands open over an empty field. */
  it("keeps the armed press closed until the address is typed", async (t) => {
    const write = mock.fn(() => Promise.resolve());
    /* The clock spelled here rather than through `pressTwice`, whose lookup of the armed press by its name alone
       meets two controls once the arming closes it: the press, inert, and the refusal laid over it. */
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const { user, field } = await armed(write);

    closedControl(ARMED, FEHLT);
    await user.type(field, "Ada.Kowalski@");
    closedControl(ARMED, FEHLT);

    await user.type(field, "Example.org");
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: ARMED }));

    assert.equal(write.mock.callCount(), 1, "the press the address opened sent nothing, or sent twice");
  });

  /* The spellings sign-in reads as this address. Compare them raw, or fold one side alone, and the administrator
     retyping the person's mailbox meets a press that stays closed. */
  for (const [spelling, typed] of [
    ["with the domain in other capitals", "Ada.Kowalski@EXAMPLE.ORG"],
    ["with the local part in other capitals", "ada.KOWALSKI@Example.org"],
    ["between spaces", "  Ada.Kowalski@Example.org "],
  ] as const) {
    it(`opens on the address typed ${spelling}`, async () => {
      const { user, field } = await armed();

      await user.type(field, typed);

      assert.ok(isOpen(), `the address typed ${spelling} left the press closed`);
    });
  }

  /* A Kelvin sign lower-cases to a „k“ under `toLowerCase` and stays itself under sign-in's fold, which lowers
     ASCII's capitals alone: a looser fold opens the press on an identifier that is not this person's. */
  it("stays closed on an address only a looser fold would call the same", async () => {
    const { user, field } = await armed();

    await user.type(field, "Ada.\u212Aowalski@Example.org");

    assert.ok(!isOpen(), "the press opened on an identifier sign-in keeps apart from the address");
  });

  /* The guard behind the closure, for a press the closure missed: drop its armed half and a press reaching the
     control over another address erases a person nobody typed. */
  it("sends nothing on an address it does not accept, whatever reaches the press", async (t) => {
    const write = mock.fn(() => Promise.resolve());
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const { user, field } = await armed(write);

    await user.type(field, "Ada.Lovelace@Example.org");
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    act(() => {
      control?.press(write);
    });

    assert.equal(write.mock.callCount(), 0, "a press over an address the field does not accept sent the write");
  });

  /* The write runs inside the two-press hook, so a second press before the render reporting it is refused there;
     a composition sending the write itself would send it twice. */
  it("inherits the hook's refusal of a press while the write flies", async (t) => {
    const write = mock.fn(() => new Promise<void>(() => undefined));
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const { user, field } = await armed(write);

    await user.type(field, ADDRESS);
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    // Both presses from one render, the second landing before React has reported the first one's write.
    act(() => {
      const confirming = control;
      confirming?.press(write);
      confirming?.press(write);
    });

    assert.equal(write.mock.callCount(), 1, "the confirmed press sent nothing, or a press while the write flew sent it again");
  });

  /* An address kept from a cancelled arming would open the press the moment the alert stands again, a two-press
     control with nothing typed. */
  it("asks for the address afresh on every arming", async () => {
    const { user, field } = await armed();

    await user.type(field, ADDRESS);
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    await user.click(screen.getByRole("button", { name: RESTING }));

    const again = await screen.findByRole("textbox", { name: `Gib zur Bestätigung die Adresse „${ADDRESS}“ ein` });
    assert.equal((again as HTMLInputElement).value, "", "the field kept the address typed before the cancel");
    closedControl(ARMED, FEHLT);
  });
});
