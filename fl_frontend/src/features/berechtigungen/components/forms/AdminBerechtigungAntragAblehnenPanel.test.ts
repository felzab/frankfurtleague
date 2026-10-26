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
const { AdminBerechtigungAntragAblehnenPanel } = await import("./AdminBerechtigungAntragAblehnenPanel.tsx");
const { StepUpContext } = await import("@/shared/components/ui/stepUp.ts");
const { DOUBLE_PRESS_MS } = await import("@/shared/hooks/useTwoPressConfirm.ts");

const ANTRAG_ID = "68c1f0a2b3c4d5e6f7a8b9e1";

/** A session inside the window: the prompt is the confirm panel sweep's to drive (`shared/components/ui/confirmPanels.test.ts`). */
const FRESH = { isStale: () => false, confirm: () => Promise.resolve(true) };

const antrag = (verwehrt: "gestartet" | null) => ({
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
  verwehrt,
});

/** Armed on `resting` and pressed on `armed`: the first press only asks, and a press too soon after it is a double click. */
async function drueckeZweimal(t: TestContext, verwehrt: "gestartet" | null, resting: string, armed: string): Promise<void> {
  const user = userEvent.setup();
  render(
    h(
      StepUpContext.Provider,
      { value: FRESH },
      underNext(h(AdminBerechtigungAntragAblehnenPanel, { antrag: antrag(verwehrt), zeile: "neu@schule.de" })),
    ),
  );
  t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
  await user.click(screen.getByRole("button", { name: resting }));
  t.mock.timers.tick(DOUBLE_PRESS_MS);
  await user.click(screen.getByRole("button", { name: armed }));
  await act(answered);
}

beforeEach(() => {
  calls.length = 0;
  toasts.length = 0;
  answerWith(() => Promise.resolve({ success: true, message: "Der Antrag ist gelöscht. Am Zugang ändert sich nichts." }));
});

/* One write serves both, so the words alone tell the approver's refusal from the requester's withdrawal. */
describe("a request's refusal and its withdrawal", () => {
  it("refuses another administrator's request by its id, under the refusal's title", async (t) => {
    await drueckeZweimal(t, null, "Antrag ablehnen: neu@schule.de", "Ja, Antrag ablehnen");

    assert.deepEqual(
      calls.map((call) => [call.action, call.payload]),
      [["lehneAntragAbAction", { id: ANTRAG_ID }]],
    );
    await waitFor(() =>
      assert.deepEqual(
        toasts.map((shown) => [shown.variant, shown.title]),
        [["success", "Antrag abgelehnt"]],
      ),
    );
  });

  it("withdraws the reader's own request by its id, under the withdrawal's title", async (t) => {
    await drueckeZweimal(t, "gestartet", "Antrag zurückziehen: neu@schule.de", "Ja, Antrag zurückziehen");

    assert.deepEqual(
      calls.map((call) => [call.action, call.payload]),
      [["lehneAntragAbAction", { id: ANTRAG_ID }]],
    );
    await waitFor(() =>
      assert.deepEqual(
        toasts.map((shown) => [shown.variant, shown.title]),
        [["success", "Antrag zurückgezogen"]],
      ),
    );
  });
});
