import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { answerWith, answered } = doubleActions({
  modules: ["/src/features/schiedsrichter/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminCreateSchiedsrichterForm } = await import("./AdminCreateSchiedsrichterForm.tsx");

afterEach(() => {
  toasts.length = 0;
});

/** The create filled in and saved, answered with `versand`, until its toast is raised. */
async function create(versand: string): Promise<void> {
  answerWith(() =>
    Promise.resolve({ success: true, created_id: "6890a1b2c3d4e5f607800001", message: "Der Bestätigungslink ging nicht raus.", versand }),
  );
  const user = userEvent.setup();
  const { unmount } = render(underNext(h(AdminCreateSchiedsrichterForm, { onClose: () => undefined })));

  await user.type(screen.getByRole("textbox", { name: "Name" }), "Anna Meier");
  await user.type(screen.getByRole("textbox", { name: "E-Mail" }), "anna@example.de");
  await user.type(screen.getByRole("textbox", { name: "Standard-Honorar" }), "20");
  await user.click(screen.getByRole("button", { name: "Speichern" }));
  // The write runs inside a transition, so the press returns before its toast is raised.
  await act(answered);
  await waitFor(() => assert.ok(toasts.length > 0, "the create raised no toast at all"));
  unmount();
}

describe("what the referee create says of the link it sent", () => {
  /* The referee stands whatever the link did, and one whose link did not go out holds no way to confirm:
     never announced as a clean create. */
  for (const versand of ["fehlgeschlagen", "gesperrt", "zurueckgehalten"]) {
    it(`grades a create whose link is ${versand} a warning, its sentence the body`, async () => {
      await create(versand);

      assert.deepEqual(
        toasts.map(({ variant, title, description }) => [variant, title, description]),
        [["warning", "Mit Folgen angelegt", "Der Bestätigungslink ging nicht raus."]],
      );
    });
  }

  it("titles a create whose link went out as a clean one", async () => {
    await create("gesendet");

    assert.deepEqual(
      toasts.map(({ variant, title }) => [variant, title]),
      [["success", "Schiedsrichter angelegt"]],
    );
  });
});
