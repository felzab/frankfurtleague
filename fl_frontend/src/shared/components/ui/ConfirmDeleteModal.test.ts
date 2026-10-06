import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { answersInFlight } from "@/shared/testing/answersInFlight.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";
import { outcomeUnknown } from "@/shared/utils/actionError.ts";

import type { ActionResult } from "@/shared/types/types.ts";

// Replaced at the module boundary: the real toast module hands its raising to HeroUI's queue.
const { raised } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { ConfirmDeleteModal } = await import("./ConfirmDeleteModal.tsx");
const { NAME_WRAP_CLASSES } = await import("./nameWrap.ts");

/**
 * The write's answers, held until they land: the write arrives as a prop, so no module double stands
 * between the dialog and the case to record it.
 */
const { track: handedOut, answered } = answersInFlight();

/** The dialog over Halle West, retiring through `onConfirm`. */
const dialog = (onConfirm: () => Promise<ActionResult>) =>
  h(ConfirmDeleteModal, {
    isOpen: true,
    onClose: () => undefined,
    onRetired: () => undefined,
    heading: "Spielort stilllegen",
    entityLabel: "den Spielort",
    entityName: "Halle West",
    consequence: "Er fehlt dann in der Auswahl.",
    successMessage: "Spielort stillgelegt",
    failureMessage: "Spielort nicht stillgelegt",
    onConfirm: () => handedOut("onConfirm", onConfirm()),
  });

describe("the retirement dialog", () => {
  /* The edge cutting the request rejects the action after the row may have been retired, and a
     rejection left to the dialog's transition replaces the page with the error page. */
  it("stays open over a rejected retirement, and says nobody can tell whether the row went", async () => {
    const user = userEvent.setup();
    render(underNext(dialog(() => Promise.reject<ActionResult>(new Error("An unexpected response was received from the server.")))));

    await pressTwice(user, { resting: "Stilllegen", armed: "Ja, stilllegen" });
    await act(answered);
    // Found rather than got: the press lets go, disarmed as every two-press control is, once the rejection has been answered.
    await screen.findByRole("button", { name: "Stilllegen" });

    const { error, outcome } = outcomeUnknown();
    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title, toast.description, toast.options?.outcome]),
      [["danger", "Unklar, ob es gespeichert wurde", error, outcome]],
    );
  });

  /* One motor action rather than two read decisions: the second click lands on step 2 before its
     consequence could have been read. */
  it("arms step 2 on a double-click and retires nothing", async () => {
    const user = userEvent.setup();
    let asked = 0;
    render(
      underNext(
        dialog(() => {
          asked += 1;
          return Promise.resolve({ success: true, message: "Spielort stillgelegt" });
        }),
      ),
    );

    await user.dblClick(screen.getByRole("button", { name: "Stilllegen" }));

    assert.equal(asked, 0, "a double-click retired the row before step 2 was read");
    assert.ok(screen.getByRole("alert"), "the double-click left step 2 unshown");
  });

  /* The name is whatever the entity is called, and the dialog clips what passes its edge: an
     inline-block sizes to its longest word unless it is capped and may break it. */
  it("breaks a name wider than the dialog inside its chip", () => {
    render(underNext(dialog(() => Promise.resolve({ success: true, message: "Spielort stillgelegt" }))));

    const chip = screen.getByText("Halle West");
    for (const token of NAME_WRAP_CLASSES.split(" ")) {
      assert.ok(chip.classList.contains(token), `the name's chip is missing ${token}, so a long name is cut off at the dialog's edge`);
    }
  });
});
