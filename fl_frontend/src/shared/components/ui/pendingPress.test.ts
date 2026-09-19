import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import type { ActionResult } from "@/shared/types/types.ts";
import type { FLDraftStatus } from "@/shared/utils/draftStatus.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { ConfirmDeleteModal } = await import("./ConfirmDeleteModal.tsx");
const { DraftStatusProvider } = await import("./DraftStatusContext.tsx");
const { FormActionBar } = await import("./FormActionBar.tsx");

/* A running write holds its control rather than closing it: `disabled` takes a button out of the tab order, dropping
   the keyboard's focus to the page in the middle of the press (`docs/frontend/spec.md` §1.14). */
describe("a control whose write is running", () => {
  it("holds the delete confirmation, which writes once however often it is pressed", async () => {
    const user = userEvent.setup();
    const onConfirm = mock.fn(() => new Promise<ActionResult>(() => {}));
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
        onConfirm,
      }),
    );

    await user.click(screen.getByRole("button", { name: "Stilllegen" }));
    await user.click(screen.getByRole("button", { name: "Ja, stilllegen" }));
    const laufend = screen.getByRole("button", { name: "Legt still..." });
    await user.click(laufend);

    assert.equal(onConfirm.mock.callCount(), 1, "a second press during the write sends it again");
    assert.equal((laufend as HTMLButtonElement).disabled, false, "the running press is closed as though something refused it");
  });

  it("holds the save bar's Speichern", () => {
    const NAME = {
      path: "name",
      label: "Name",
      group: "stammdaten",
      isChanged: true,
      error: null,
      storedText: "Halle",
      draftText: "Halle West",
    };
    const DIRTY: FLDraftStatus<string> = { fields: [NAME], byPath: new Map([[NAME.path, NAME]]), changed: [NAME], invalid: [], isDirty: true };

    render(
      h(DraftStatusProvider, { status: DIRTY, children: h(FormActionBar, { isPending: true, isLeaving: false, onCancel: () => undefined }) }),
    );

    const speichern = screen.getByRole("button", { name: "Speichert..." }) as HTMLButtonElement;
    assert.equal(speichern.disabled, false, "the running save is closed as though something refused it");
    assert.equal(speichern.getAttribute("data-pending"), "true", "the running save still takes a press");
  });
});
