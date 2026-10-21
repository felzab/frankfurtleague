import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { TestContext } from "node:test";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { answerWith, answered, calls } = doubleActions({
  modules: ["/src/features/berechtigungen/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminBerechtigungAntragGenehmigenPanel } = await import("./AdminBerechtigungAntragGenehmigenPanel.tsx");
const { StepUpContext } = await import("@/shared/components/ui/stepUp.ts");
const { DOUBLE_PRESS_MS } = await import("@/shared/hooks/useTwoPressConfirm.ts");

const ANTRAG_ID = "68c1f0a2b3c4d5e6f7a8b9e1";

/** A session inside the window: the prompt is the confirm panel sweep's to drive (`shared/components/ui/confirmPanels.test.ts`). */
const FRESH = { isStale: () => false, confirm: () => Promise.resolve(true) };

const ANTRAG = {
  id: ANTRAG_ID,
  adresse: "neu@schule.de",
  gesperrt: false,
  berechtigung_id: null,
  verwaltung: "administration" as const,
  gestartet_von: "inhaber@schule.de",
  gestartet_von_gesperrt: false,
  angefragt_am: "2026-10-20T11:30:00Z",
  bis: "2026-10-27T11:30:00Z",
  steht: true,
  verwehrt: null,
};

/** Armed and pressed, as an administrator approves: the first press only asks, and a press too soon after it is a double click. */
async function genehmige(t: TestContext): Promise<void> {
  const user = userEvent.setup();
  render(
    h(
      StepUpContext.Provider,
      { value: FRESH },
      underNext(h(AdminBerechtigungAntragGenehmigenPanel, { antrag: ANTRAG, zeile: "neu@schule.de" })),
    ),
  );
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  await user.click(screen.getByRole("button", { name: "Antrag genehmigen: neu@schule.de" }));
  // The approver is the second pair of eyes a pretext has to get past, so the armed press asks for the check it stands for.
  assert.match(document.body.textContent ?? "", /Genehmige nur, wenn Du sicher bist, dass die Person ihn bekommen soll\./);
  t.mock.timers.tick(DOUBLE_PRESS_MS);
  await user.click(screen.getByRole("button", { name: "Ja, Antrag genehmigen" }));
  await act(answered);
}

beforeEach(() => {
  calls.length = 0;
  toasts.length = 0;
});

describe("a request's approval", () => {
  it("approves the request by its id on the second press, under the approval's own title", async (t) => {
    answerWith(() => Promise.resolve({ success: true, message: "Der Antrag ist genehmigt. Alle mit Zugang erhalten eine E-Mail." }));

    await genehmige(t);

    assert.deepEqual(
      calls.map((call) => [call.action, call.payload]),
      [["genehmigeAntragAction", { id: ANTRAG_ID }]],
    );
    await waitFor(() =>
      assert.deepEqual(
        toasts.map((shown) => [shown.variant, shown.title, shown.description]),
        [["success", "Antrag genehmigt", "Der Antrag ist genehmigt. Alle mit Zugang erhalten eine E-Mail."]],
      ),
    );
  });

  it("raises a refusal in the backend's words under the approval's failure title", async (t) => {
    answerWith(() => Promise.resolve({ success: false, error: "Dieser Antrag ist nicht mehr offen. Lade die Seite neu." }));

    await genehmige(t);

    await waitFor(() =>
      assert.deepEqual(
        toasts.map((shown) => [shown.title, shown.description]),
        [["Nicht genehmigt", "Dieser Antrag ist nicht mehr offen. Lade die Seite neu."]],
      ),
    );
  });
});
