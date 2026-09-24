import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { unansweredAction } from "@/shared/utils/actionError.ts";

import type { ActionResult } from "@/shared/types/types.ts";

// Replaced at the module boundary: the real toast module hands its raising to HeroUI's queue.
const { raised } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { ConfirmDeleteModal } = await import("./ConfirmDeleteModal.tsx");

describe("the retirement dialog", () => {
  /* The edge cutting the request rejects the action after the row may have been retired, and a
     rejection left to the dialog's transition replaces the page with the error page. */
  it("stays open over a rejected retirement, and says nobody can tell whether the row went", async () => {
    const user = userEvent.setup();
    render(
      h(ConfirmDeleteModal, {
        isOpen: true,
        onClose: () => undefined,
        heading: "Spielort stilllegen",
        entityLabel: "den Spielort",
        entityName: "Halle West",
        consequence: "Er fehlt dann in der Auswahl.",
        successMessage: "Spielort stillgelegt",
        failureMessage: "Spielort nicht stillgelegt",
        onConfirm: () => Promise.reject<ActionResult>(new Error("An unexpected response was received from the server.")),
      }),
    );

    await user.click(screen.getByRole("button", { name: "Stilllegen" }));
    await user.click(screen.getByRole("button", { name: "Ja, stilllegen" }));
    // Found rather than got: the press lets go once the rejection has been answered.
    await screen.findByRole("button", { name: "Ja, stilllegen" });

    const { error, outcome } = unansweredAction();
    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title, toast.description, toast.options?.outcome]),
      [["danger", "Spielort nicht stillgelegt", error, outcome]],
    );
  });
});
