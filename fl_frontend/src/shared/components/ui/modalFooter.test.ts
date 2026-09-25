import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, within } from "@testing-library/react";
import { z } from "zod";

import { underNext } from "@/shared/testing/nextContexts.ts";

import { formButton, MODAL_FOOTER_CLASSES } from "./formButtons.ts";

import type { ReactNode } from "react";

const nothing = (): undefined => undefined;

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { DescriptionEditModal } = await import("@/features/teams/components/modals/DescriptionEditModal.tsx");
const { ConfirmDeleteModal } = await import("./ConfirmDeleteModal.tsx");
const { ConfirmDiscardModal } = await import("./ConfirmDiscardModal.tsx");
const { ConfirmSaveModal } = await import("./ConfirmSaveModal.tsx");
const { EntityForm } = await import("./EntityForm.tsx");

/** Each footer's component, open. */
const OPEN: Record<string, ReactNode> = {
  "features/teams/components/modals/DescriptionEditModal.tsx": h(DescriptionEditModal, {
    isOpen: true,
    onClose: nothing,
    value: "Schulteam aus dem Nordend",
    onApply: nothing,
  }),
  "shared/components/ui/ConfirmDeleteModal.tsx": h(ConfirmDeleteModal, {
    isOpen: true,
    onClose: nothing,
    heading: "Spielort stilllegen",
    entityLabel: "den Spielort",
    entityName: "Sportplatz Nord",
    consequence: "Er wird keinem Spiel mehr angeboten.",
    onConfirm: async () => ({ success: true as const, message: "Spielort stillgelegt" }),
    successMessage: "Spielort stillgelegt",
    failureMessage: "Spielort nicht stillgelegt",
  }),
  "shared/components/ui/ConfirmDiscardModal.tsx": h(ConfirmDiscardModal, {
    isOpen: true,
    onClose: nothing,
    onDiscard: nothing,
    changeCount: 2,
  }),
  "shared/components/ui/ConfirmSaveModal.tsx": h(ConfirmSaveModal, {
    onClose: nothing,
    onConfirm: nothing,
    banners: [{ id: "ergebnis", severity: "danger", raisedBy: "change", title: "Das Ergebnis wird überschrieben", inline: null }],
  }),
  "shared/components/ui/EntityForm.tsx": h(EntityForm<Record<string, never>>, {
    initialDraft: {},
    renderFields: () => null,
    onSubmit: async () => ({ success: true as const, message: "Spielort angelegt" }),
    schema: z.object({}),
    toPayload: (draft) => draft,
    successMessage: "Spielort angelegt",
    onClose: nothing,
  }),
};

const tokens = (classes: string): string[] => classes.split(/\s+/).filter(Boolean);

/** What the way back wears and neither action intent does, so the shared base is never what is compared. */
const WAY_BACK = tokens(formButton({ intent: "cancel" })).filter(
  (token) => !tokens(formButton({ intent: "submit" })).includes(token) && !tokens(formButton({ intent: "destructive" })).includes(token),
);

describe("every dialog footer", () => {
  it("parts the way back from both action intents, so the order below can be read", () => {
    assert.ok(WAY_BACK.length > 0, "the way back wears nothing an action does not, so no button below can be told apart");
  });

  /* One place for the press a hand has learned: a create dialog putting „Abbrechen“ where a confirmation
     puts its action sends the reader who moves between them to the wrong button. */
  for (const [file, open] of Object.entries(OPEN)) {
    it(`puts the action first and the way back second: ${file}`, () => {
      const { unmount } = render(underNext(open));
      // The band carries no role of its own, so the recipe it wears is what finds it; its buttons are
      // then read the way a reader meets them.
      const band =
        [...document.querySelectorAll("div")].find((element) =>
          tokens(MODAL_FOOTER_CLASSES).every((token) => element.classList.contains(token)),
        ) ?? assert.fail("no element wears the footer band");
      const buttons = within(band).getAllByRole("button");

      assert.deepEqual(
        buttons.map((button) => WAY_BACK.every((token) => button.classList.contains(token))),
        [false, true],
        `the footer reads ${JSON.stringify(buttons.map((button) => button.textContent))}, not the action and then the way back`,
      );
      unmount();
    });
  }
});
