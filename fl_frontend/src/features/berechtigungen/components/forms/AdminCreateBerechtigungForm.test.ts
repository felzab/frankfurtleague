import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { answerWith, answered } = doubleActions({
  modules: ["/src/features/berechtigungen/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminCreateBerechtigungForm } = await import("./AdminCreateBerechtigungForm.tsx");
const { StepUpContext } = await import("@/shared/components/ui/stepUp.ts");
const { ZUGANG_BEANTRAGT, ZUGANG_BEANTRAGT_MESSAGE, ZUGANG_ERTEILT } = await import("@/features/berechtigungen/constants.ts");

/** A session inside the window: the prompt is the confirm panel sweep's to drive (`shared/components/ui/confirmPanels.test.ts`). */
const FRESH = { isStale: () => false, confirm: () => Promise.resolve(true) };

async function grant(): Promise<void> {
  const user = userEvent.setup();
  render(h(StepUpContext.Provider, { value: FRESH }, underNext(h(AdminCreateBerechtigungForm, { onClose: () => undefined }))));
  await user.type(screen.getByRole("textbox", { name: "E-Mail" }), "neu@schule.de");
  await user.click(screen.getByRole("button", { name: "Speichern" }));
  await act(answered);
}

beforeEach(() => {
  toasts.length = 0;
});

describe("the create of a grant", () => {
  /* A request is a save that stood and cost nothing, as the tier panel's promotion request is: raised as a warning, it
     reads as a grant made with a fault, and under the grant's title, as a grant made. */
  it("raises a grant asked of another administrator as a success under the request's own title", async () => {
    answerWith(() =>
      Promise.resolve({ success: true, created_id: "68c1f0a2b3c4d5e6f7a8b9e1", beantragt: true, message: ZUGANG_BEANTRAGT_MESSAGE }),
    );

    await grant();

    await waitFor(() =>
      assert.deepEqual(
        toasts.map((toast) => [toast.variant, toast.title, toast.description]),
        [["success", ZUGANG_BEANTRAGT, ZUGANG_BEANTRAGT_MESSAGE]],
      ),
    );
  });

  it("raises a grant made at once under the grant's title", async () => {
    answerWith(() => Promise.resolve({ success: true, created_id: "68c1f0a2b3c4d5e6f7a8b9e1", beantragt: false, message: ZUGANG_ERTEILT }));

    await grant();

    await waitFor(() =>
      assert.deepEqual(
        toasts.map((toast) => [toast.variant, toast.title, toast.description]),
        [["success", ZUGANG_ERTEILT, undefined]],
      ),
    );
  });
});
