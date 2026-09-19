import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { CLOSED_OVERLAY, nextOverlay } from "./useHoverOpenOverlay.ts";

type OverlayEvent = Parameters<typeof nextOverlay>[1];

/** The overlay after `events`, from closed. */
const after = (...events: OverlayEvent[]) => events.reduce(nextOverlay, CLOSED_OVERLAY);

describe("how an overlay opens", () => {
  it("opens a hover as a hover and a press as the dialog", () => {
    assert.deepEqual(after("pointerOnTrigger"), { isOpen: true, openedBy: "hover", awaitsLeave: false });
    assert.deepEqual(after("press"), { isOpen: true, openedBy: "press", awaitsLeave: false });
  });

  /* A mouse reaches the trigger before it presses, so every mouse press lands on a panel the hover opened. */
  it("turns a hover-opened panel into the dialog on a press", () => {
    assert.equal(after("pointerOnTrigger", "press").openedBy, "press");
  });

  /* A move can land between a click and the underlay the dialog it opened mounts. */
  it("never demotes a dialog when the pointer moves over the trigger", () => {
    assert.equal(after("press", "pointerOnTrigger").openedBy, "press");
  });

  /* The panel stays mounted while it animates out, and a dialog swapped in for that exit takes focus. */
  it("keeps how it opened through its close", () => {
    assert.deepEqual(after("pointerOnTrigger", "pointerOutOfReach"), { isOpen: false, openedBy: "hover", awaitsLeave: false });
  });
});

describe("an overlay closed under a pointer still on the trigger", () => {
  /* A dialog's underlay leaving from under a resting pointer fires no move of its own, and a hand on a mouse is never
     still: either reopening the panel makes a dismissal take a second one (WCAG 1.4.13). */
  for (const [how, ...closing] of [
    ["Escape over a hover-opened panel", "pointerOnTrigger", "escape"],
    ["a dismissed dialog", "press", "dismiss"],
  ] as const) {
    it(`stays closed after ${how} until the pointer has been off the trigger`, () => {
      assert.equal(after(...closing, "pointerOnTrigger").isOpen, false, "a pointer still on the trigger reopens the panel");
      assert.equal(after(...closing, "pointerOffTrigger", "pointerOnTrigger").isOpen, true, "a pointer that left and came back opens nothing");
    });
  }

  /* Closed by the pointer's own leaving, there is nothing left to wait for. */
  it("opens again on the next hover once the pointer has left its reach", () => {
    assert.equal(after("pointerOnTrigger", "pointerOutOfReach", "pointerOnTrigger").isOpen, true);
  });
});
