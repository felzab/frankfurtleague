import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it, mock } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { z } from "zod";

import type { ActionResult } from "@/shared/types/types.ts";

// Replaced at the module boundary: the real toast module hands its raising to HeroUI's queue.
const APP_TOAST = `const raise = () => () => "0";
export const UNDO_TIMEOUT_MS = 1;
export const appToast = { success: raise(), warning: raise(), danger: raise(), info: raise(), pending: raise(), close: () => {}, clear: () => {} };`;

registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/shared/utils/appToast.ts")) return { format: "module", source: APP_TOAST, shortCircuit: true };
    return nextLoad(url, context);
  },
});

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { FieldError, Input, Label, TextField } = await import("@heroui/react");
const { EntityForm } = await import("./EntityForm.tsx");

type Draft = { name: string };

/** A caller whose payload step trims: the padded value as typed is one the schema below refuses. */
function renderTrimmingCaller(onSubmit: (payload: Draft) => Promise<ActionResult>) {
  render(
    h(EntityForm<Draft, Draft>, {
      initialDraft: { name: "" },
      renderFields: (draft, setDraft) =>
        h(
          TextField,
          { isRequired: true, name: "name", value: draft.name, onChange: (next: string) => setDraft({ name: next }) },
          h(Label, null, "Name"),
          h(Input),
          h(FieldError),
        ),
      schema: z.object({ name: z.string().regex(/^\S+$/, { error: "Ohne Leerzeichen." }) }),
      toPayload: (draft) => ({ name: draft.name.trim() }),
      onSubmit,
      successMessage: "Angelegt",
      onClose: () => undefined,
    }),
  );
}

describe("the create form", () => {
  /* The block judges the payload step's output, so handing the write the raw draft sends a value the
     schema never saw, one it would have refused. */
  it("sends the payload the block judged, not the draft it was built from", async () => {
    const user = userEvent.setup();
    const onSubmit = mock.fn(async (_payload: Draft): Promise<ActionResult> => ({ success: true, message: "Angelegt" }));
    renderTrimmingCaller(onSubmit);

    await user.type(screen.getByRole("textbox", { name: "Name" }), "  Lena  ");
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    assert.deepEqual(
      onSubmit.mock.calls.map((call) => call.arguments[0]),
      [{ name: "Lena" }],
      "the write received the draft as typed, or nothing at all",
    );
  });

  /* A running write holds both buttons rather than closing them (`docs/frontend/spec.md` §1.14): the way back would
     unmount the form under a transition whose toast then reaches nobody. */
  it("holds its save and its way back while the write runs", async () => {
    const user = userEvent.setup();
    renderTrimmingCaller(() => new Promise<ActionResult>(() => {}));

    await user.type(screen.getByRole("textbox", { name: "Name" }), "Lena");
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    for (const name of ["Speichert...", "Abbrechen"]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      assert.equal(button.getAttribute("data-pending"), "true", `„${name}“ still takes a press while the write runs`);
      assert.equal(button.disabled, false, `„${name}“ is closed as though something refused it`);
    }
  });
});
