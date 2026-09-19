import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import type { BlockingBanners } from "./railBanner.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { ConfirmSaveModal } = await import("./ConfirmSaveModal.tsx");

/** One consequence the pending save causes, which is what raises the dialog at all. */
const FOLGE: BlockingBanners = [
  { id: "spielort.name", severity: "warning", raisedBy: "change", title: "Jedes Spiel an diesem Ort ändert sich mit", inline: null },
];

describe("the save confirmation's one press per raise", () => {
  /* Every editor's confirm runs its write directly, never back through the gate, so nothing but this latch
     stops a second press on a dialog still standing from sending the save a second time. */
  it("writes once however often „Trotzdem speichern“ is pressed while the dialog stands, and keeps the way back closed meanwhile", async () => {
    const user = userEvent.setup();
    const onConfirm = mock.fn();
    const onClose = mock.fn();
    render(h(ConfirmSaveModal, { banners: FOLGE, onConfirm, onClose }));

    await user.click(screen.getByRole("button", { name: "Trotzdem speichern" }));
    await user.click(screen.getByRole("button", { name: "Trotzdem speichern" }));
    await user.click(screen.getByRole("button", { name: "Weiter bearbeiten" }));

    assert.equal(onConfirm.mock.callCount(), 1, "a second press on a dialog still standing wrote again");
    assert.equal(onClose.mock.callCount(), 0, "the way back stays pressable over a write already sent");
  });

  /* The latch is per raise, and a raise may hand the very same list back: a latch keyed on the list would
     leave the next dialog closed to the one press it exists for. */
  it("takes the one press again the next time it is raised, over the same list", async () => {
    const user = userEvent.setup();
    const onConfirm = mock.fn();
    const onClose = mock.fn();
    const { rerender } = render(h(ConfirmSaveModal, { banners: FOLGE, onConfirm, onClose }));

    await user.click(screen.getByRole("button", { name: "Trotzdem speichern" }));
    // What every editor does with the confirm: clear the snapshot, and later raise the same list again.
    rerender(h(ConfirmSaveModal, { banners: null, onConfirm, onClose }));
    rerender(h(ConfirmSaveModal, { banners: FOLGE, onConfirm, onClose }));

    await user.click(screen.getByRole("button", { name: "Weiter bearbeiten" }));
    assert.equal(onClose.mock.callCount(), 1, "the dialog raised again offers no way back");

    await user.click(screen.getByRole("button", { name: "Trotzdem speichern" }));
    assert.equal(onConfirm.mock.callCount(), 2, "the dialog raised again stays closed to its press");
  });
});
