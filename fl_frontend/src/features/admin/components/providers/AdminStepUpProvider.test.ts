import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { replacingModule } from "@/core/exportingModule.ts";
import { ENROLMENT_WINDOW_MS, STEP_UP_WINDOW_MS } from "@/core/sessionLifetimes.ts";
import { STEP_UP_LABEL, STEP_UP_REFUSED, STEP_UP_RUNNING } from "@/shared/components/ui/stepUp.ts";
import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { TestContext } from "node:test";

/* The browser's credential call, replaced at the module boundary: this runner has no
   `navigator.credentials`, and a test-only prop would be a seam in production code. */
const CLIENT_DOUBLE = { authClient: { signIn: { passkey: () => prompt() } } };

registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/authClient.ts"))
      return { format: "module", source: replacingModule(url, "the sign-in client", CLIENT_DOUBLE), shortCircuit: true };
    return nextLoad(url, context);
  },
});

let prompts = 0;
/** What the next prompt answers. Better Auth reports a cancelled prompt on `error`, never by throwing. */
let promptAnswer: () => Promise<unknown> = () => Promise.resolve({ data: {}, error: null });

function prompt(): Promise<unknown> {
  prompts += 1;
  return promptAnswer();
}

/** Whether the session a confirmation mints is the asking administrator's, as the holder check answers it. */
let heldBy = true;

const { calls } = doubleActions({
  modules: [/\/features\/sperrliste\/actions\.ts$/, /\/features\/berechtigungen\/actions\.ts$/, /\/features\/admin\/actions\.ts$/],
  // One answer for the write and the holder check: each reads its own field of it.
  answer: () => Promise.resolve({ success: true, message: "Gespeichert.", gleich: heldBy }),
});

/** The writes the panel sent, the holder check left out. */
const writes = (): string[] => calls.map((call) => call.action).filter((action) => action !== "pruefeAdministratorAction");
doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminStepUpProvider } = await import("./AdminStepUpProvider.tsx");
const { AdminSperreAufhebenPanel } = await import("@/features/sperrliste/components/forms/AdminSperreAufhebenPanel.tsx");
const { AdminBerechtigungEntziehenPanel } = await import("@/features/berechtigungen/components/forms/AdminBerechtigungEntziehenPanel.tsx");
const { AdminCreateBerechtigungForm } = await import("@/features/berechtigungen/components/forms/AdminCreateBerechtigungForm.tsx");

const RESTING = "Sperre vom 12.03.2026 aufheben";
const ARMED = "Ja, Sperre vom 12.03.2026 endgültig aufheben";

/** One step-up panel under the provider, as a server render of the administrator's shell hands it over. */
const page = (freshUntil: number | null) =>
  underNext(
    h(AdminStepUpProvider, {
      served: { freshUntil, enrolmentUntil: null, inhaberId: "administrator" },
      children: h(AdminSperreAufhebenPanel, { sperreId: "6890a1b2c3d4e5f607190001", gesperrtAm: "12.03.2026" }),
    }),
  );

/** Arms the panel and answers with the name its armed control then carries. */
async function arm(user: ReturnType<typeof userEvent.setup>): Promise<string> {
  await user.click(screen.getByRole("button", { name: RESTING }));
  const armed = await screen.findByRole("button", { name: new RegExp(`^(${STEP_UP_LABEL}|${ARMED})$`) });
  return armed.textContent;
}

/** The armed press, past the double-press window the arming opened. */
async function confirm(t: TestContext, user: ReturnType<typeof userEvent.setup>, name: string): Promise<void> {
  t.mock.timers.tick(DOUBLE_PRESS_MS);
  await user.click(screen.getByRole("button", { name }));
  await screen.findByRole("button", { name: RESTING });
}

describe("the administrator's step-up window", () => {
  beforeEach(() => {
    prompts = 0;
    promptAnswer = () => Promise.resolve({ data: {}, error: null });
    heldBy = true;
  });

  /* A confirmation is a fresh sign-in, so what it buys is the window again: drop the provider's own
     figure and the second step-up write of a sitting asks for the passkey again. */
  it("asks once, and the next write inside two hours asks nothing", async (t) => {
    const user = userEvent.setup();
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const { unmount } = render(page(null));

    assert.equal(await arm(user), STEP_UP_LABEL, "a stale session armed without asking for the passkey");
    await confirm(t, user, STEP_UP_LABEL);
    assert.equal(prompts, 1, "the armed press sent the write without the prompt");

    t.mock.timers.tick(STEP_UP_WINDOW_MS - DOUBLE_PRESS_MS - 1);
    assert.equal(await arm(user), ARMED, "a write inside the window asked for the passkey again");
    await confirm(t, user, ARMED);

    unmount();
    assert.equal(prompts, 1, "a write inside the window ran the prompt again");
    assert.deepEqual(writes(), ["deleteSperreAction", "deleteSperreAction"]);
  });

  /* Half-open at its end, as the server's own test is: the millisecond the window closes is the first
     it refuses, so the page asks from that same millisecond. */
  it("asks from the millisecond the window closes", async (t) => {
    const user = userEvent.setup();
    t.mock.timers.enable({ apis: ["Date"], now: 5_000_000 });
    const until = 5_000_000 + DOUBLE_PRESS_MS * 3;
    const { unmount } = render(page(until));

    t.mock.timers.tick(DOUBLE_PRESS_MS * 3 - 1);
    assert.equal(await arm(user), ARMED, "the last confirmed millisecond asked");
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    t.mock.timers.tick(1);
    assert.equal(await arm(user), STEP_UP_LABEL, "the first stale millisecond did not ask");
    unmount();
  });

  /* The server's figure takes over whenever a render brings one: a refused write refreshes the page,
     and a provider holding its own earlier figure would let every later press be refused again. */
  it("takes the server's figure over its own once a render brings a new one", async (t) => {
    const user = userEvent.setup();
    t.mock.timers.enable({ apis: ["Date"], now: 9_000_000 });
    const { rerender, unmount } = render(page(9_000_000 + STEP_UP_WINDOW_MS));

    assert.equal(await arm(user), ARMED);
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    rerender(page(null));
    assert.equal(await arm(user), STEP_UP_LABEL, "the server's stale figure did not replace the page's own");
    unmount();
  });

  /* A confirmation the server never saw, and a refused write whose refresh hands back the same stale
     figure: keyed on the figure, the local one stands and every later press is refused unasked. */
  it("drops a confirmation of its own at the next server render even where the figure is unchanged", async (t) => {
    const user = userEvent.setup();
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const { rerender, unmount } = render(page(null));

    await arm(user);
    await confirm(t, user, STEP_UP_LABEL);
    assert.equal(await arm(user), ARMED, "the page's own confirmation did not open the window");
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    rerender(page(null));
    assert.equal(await arm(user), STEP_UP_LABEL, "a confirmation the server's render did not carry outlived it");
    unmount();
  });

  /* Nothing is sent while the prompt stands, so the control says the prompt rather than the write. */
  it("says the prompt, never the write, while the prompt is open", async (t) => {
    const user = userEvent.setup();
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    let answerPrompt: (answer: unknown) => void = () => undefined;
    promptAnswer = () => new Promise((resolve) => (answerPrompt = resolve));
    const { unmount } = render(page(null));

    await arm(user);
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: STEP_UP_LABEL }));
    assert.ok(await screen.findByRole("button", { name: STEP_UP_RUNNING }), "the open prompt shows the write's own running words");

    answerPrompt({ data: {}, error: null });
    await screen.findByRole("button", { name: RESTING });
    unmount();
  });

  /* A refused prompt sends nothing and says so where the control stands, still armed on the prompt. */
  it("sends nothing on a refused prompt and says so beside the control", async (t) => {
    const user = userEvent.setup();
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    promptAnswer = () => Promise.resolve({ data: null, error: { code: "AUTH_CANCELLED", status: 400 } });
    const before = calls.length;
    const { unmount } = render(page(null));

    await arm(user);
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: STEP_UP_LABEL }));
    const said = await screen.findByText(STEP_UP_REFUSED);

    assert.equal(said.getAttribute("role"), "alert", "the refusal is announced to nobody");
    assert.ok(screen.getByRole("button", { name: STEP_UP_LABEL }), "the control left the prompt after a refusal");
    unmount();
    assert.equal(calls.length, before, "a refused prompt sent the write");
  });

  /* Once the page's session has ended, the challenge names nobody and the passkey asserted signs its
     own account in: the waiting write would then run as that account (`docs/frontend/spec.md :: I428`). */
  it("leaves the write unrun where the confirmation signed in another account", async (t) => {
    const user = userEvent.setup();
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    heldBy = false;
    const before = writes().length;
    const checksBefore = calls.length;
    const { unmount } = render(page(null));

    await arm(user);
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: STEP_UP_LABEL }));
    assert.ok(await screen.findByText(STEP_UP_REFUSED), "a confirmation for another account is not said to have failed");
    unmount();

    assert.deepEqual(
      calls
        .slice(checksBefore)
        .filter((call) => call.action === "pruefeAdministratorAction")
        .map((call) => call.payload),
      ["administrator"],
      "the confirmation was never checked against the administrator who asked",
    );
    assert.equal(writes().length, before, "a confirmation for another account ran the write");
  });

  /* The options request throws rather than answering `error` when it never arrives; uncaught, the press
     takes the page down with it. */
  it("reads a prompt that could not start as a refusal", async (t) => {
    const user = userEvent.setup();
    t.mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    promptAnswer = () => Promise.reject(new TypeError("Failed to fetch"));
    const { unmount } = render(page(null));

    await arm(user);
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: STEP_UP_LABEL }));

    assert.ok(await screen.findByText(STEP_UP_REFUSED));
    unmount();
  });
});

describe("the narrow window a grant's revoke is held to", () => {
  const revokeUnder = (freshUntil: number, enrolmentUntil: number) =>
    underNext(
      h(AdminStepUpProvider, {
        served: { freshUntil, enrolmentUntil, inhaberId: "administrator" },
        children: h(AdminBerechtigungEntziehenPanel, {
          berechtigungId: "6890a1b2c3d4e5f6071b0002",
          adresse: "vorstand@schule.de",
          erteiltAm: "27.09.2026",
          darfEntziehen: true,
        }),
      }),
    );

  /* The step-up window still holds here, which is what makes the case about the narrow one: armed on the
     standing figure alone, the press would be refused by the server and asked again unasked. */
  it("asks once the five minutes have passed, while the two hours still hold", async (t) => {
    const user = userEvent.setup();
    t.mock.timers.enable({ apis: ["Date"], now: 7_000_000 });
    const { unmount } = render(revokeUnder(7_000_000 + STEP_UP_WINDOW_MS, 7_000_000 - 1));

    await user.click(screen.getByRole("button", { name: "Zugang von vorstand@schule.de entziehen" }));
    assert.ok(await screen.findByRole("button", { name: STEP_UP_LABEL }), "the revoke armed on the standing window alone");
    unmount();
  });

  /* A confirmation opens both windows from its own moment, the assertion having minted a new session. */
  it("asks nothing inside the five minutes a confirmation opens", async (t) => {
    const user = userEvent.setup();
    t.mock.timers.enable({ apis: ["Date"], now: 8_000_000 });
    const { unmount } = render(revokeUnder(8_000_000 + STEP_UP_WINDOW_MS, 8_000_000 + ENROLMENT_WINDOW_MS));

    await user.click(screen.getByRole("button", { name: "Zugang von vorstand@schule.de entziehen" }));
    assert.ok(
      await screen.findByRole("button", { name: "Ja, Zugang von vorstand@schule.de endgültig entziehen" }),
      "a revoke inside the window asked",
    );
    unmount();
  });
});

describe("the narrow window a grant is held to", () => {
  beforeEach(() => {
    calls.length = 0;
    prompts = 0;
    promptAnswer = () => Promise.resolve({ data: {}, error: null });
    heldBy = true;
  });

  const grantUnder = (freshUntil: number, enrolmentUntil: number) =>
    underNext(
      h(AdminStepUpProvider, {
        served: { freshUntil, enrolmentUntil, inhaberId: "administrator" },
        children: h(AdminCreateBerechtigungForm, { onClose: () => undefined }),
      }),
    );

  /** Types an address and presses „Speichern“, answering once the grant has been sent. */
  async function grant(user: ReturnType<typeof userEvent.setup>): Promise<void> {
    await user.type(screen.getByRole("textbox", { name: "E-Mail" }), "neu@schule.de");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await waitFor(() => assert.deepEqual(writes(), ["postBerechtigungAction"]));
  }

  /* The form reads the window it declares, never the standing one: on the two hours alone, the server
     would refuse the grant, the page refresh, and the form send it again without ever asking. */
  it("asks for the passkey once the five minutes have passed, while the two hours still hold", async (t) => {
    const user = userEvent.setup();
    t.mock.timers.enable({ apis: ["Date"], now: 9_000_000 });
    const { unmount } = render(grantUnder(9_000_000 + STEP_UP_WINDOW_MS, 9_000_000 - 1));

    await grant(user);

    assert.equal(prompts, 1, "the grant went out on the standing window alone");
    unmount();
  });

  it("asks nothing inside the five minutes", async (t) => {
    const user = userEvent.setup();
    t.mock.timers.enable({ apis: ["Date"], now: 10_000_000 });
    const { unmount } = render(grantUnder(10_000_000 + STEP_UP_WINDOW_MS, 10_000_000 + ENROLMENT_WINDOW_MS));

    await grant(user);

    assert.equal(prompts, 0);
    unmount();
  });
});
