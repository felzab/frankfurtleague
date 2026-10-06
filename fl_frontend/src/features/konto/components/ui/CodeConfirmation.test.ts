import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

import { act, createElement as h } from "react";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { EDGE_REFUSAL_BODY, ZU_VIELE_VERSUCHE } from "@/shared/utils/actionError.ts";

const ADDRESS = "spielerin@example.org";

/** The send, replaced at the module boundary: the real one needs a session store and a mail provider. */
const SENT = { success: true, message: "Ein Anmeldecode ist an Deine Adresse unterwegs." };

const { calls, answered, answerWith } = doubleActions({
  modules: ["/src/features/konto/actions.ts"],
  answer: () => Promise.resolve(SENT),
});
const { raised } = doubleToasts();
const fetchMock = doubleFetch();

const { KONTO_FORBIDDEN } = await import("@/shared/utils/kontoMutation.ts");

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { CodeConfirmation } = await import("./CodeConfirmation.tsx");

describe("the confirmation as the page opens", () => {
  /* The send's control is mounted with its ref at load, so only the refusal's flag keeps it from the focus. */
  it("leaves the focus where the page put it", () => {
    render(h(CodeConfirmation, { address: ADDRESS, istInhaber: () => Promise.resolve(true), onConfirmed: () => undefined }));

    // A boolean rather than the node: a failing comparison would inspect a jsdom node, which holds the whole window.
    const genommen = document.activeElement === screen.getByRole("button", { name: "Code per E-Mail senden" });
    assert.ok(!genommen, "the send's control took the focus as the page loaded");
  });
});

describe("the step-up's send", () => {
  /* The address is the session's: the action takes nothing a page could set. */
  it("posts no address", async () => {
    const user = userEvent.setup();
    const before = calls.length;
    render(h(CodeConfirmation, { address: ADDRESS, istInhaber: () => Promise.resolve(true), onConfirmed: () => undefined }));

    await user.click(screen.getByRole("button", { name: "Code per E-Mail senden" }));
    await act(answered);

    assert.deepEqual(
      calls.slice(before).map((call) => ({ action: call.action, payload: call.payload })),
      [{ action: "sendeBestaetigungscodeAction", payload: undefined }],
    );
  });

  /* As Next's action client raises the edge's own 429. Read as any other rejection, it would replace the
     account page with its route's error boundary. */
  it("says the edge refused the send and when to try again, the send still offered", async () => {
    const user = userEvent.setup();
    raised.length = 0;
    answerWith(() => Promise.reject(new Error(EDGE_REFUSAL_BODY)));
    render(h(CodeConfirmation, { address: ADDRESS, istInhaber: () => Promise.resolve(true), onConfirmed: () => undefined }));

    await user.click(screen.getByRole("button", { name: "Code per E-Mail senden" }));
    await act(answered);

    await waitFor(() =>
      assert.deepEqual(
        raised.map(({ title, description }) => ({ title, description })),
        [{ title: "Code nicht gesendet", description: ZU_VIELE_VERSUCHE }],
      ),
    );
    assert.equal(screen.queryAllByRole("button", { name: "Code per E-Mail senden" }).length, 1, "the refused send took its control down");
    // The suite's toasts and answer as the cases after this one find them.
    raised.length = 0;
    answerWith(() => Promise.resolve(SENT));
  });

  /* The code the first send mailed stays good, so a refused resend says why and leaves its step standing. */
  /* A dropped connection or a deployment's unknown action rejects the send with no answer. Read by no
     catch, it would replace the account page with its route's error boundary, the passkeys and sign-ins with it. */
  it("answers a send that drew no answer on the page, offering the send again", async () => {
    const user = userEvent.setup();
    raised.length = 0;
    answerWith(() => Promise.reject(new TypeError("Failed to fetch")));
    render(h(CodeConfirmation, { address: ADDRESS, istInhaber: () => Promise.resolve(true), onConfirmed: () => undefined }));

    await user.click(screen.getByRole("button", { name: "Code per E-Mail senden" }));
    await act(answered);

    await waitFor(() =>
      assert.deepEqual(
        raised.map(({ title, description }) => ({ title, description })),
        [
          {
            title: "Code nicht gesendet",
            description:
              "Wir wissen nicht, ob der Code verschickt wurde. Prüfe die Verbindung und fordere ihn erneut an; ein neuer Code ersetzt einen früheren.",
          },
        ],
      ),
    );
    assert.equal(screen.queryAllByRole("button", { name: "Code per E-Mail senden" }).length, 1, "the unanswered send took its control down");
    raised.length = 0;
    answerWith(() => Promise.resolve(SENT));
  });

  it("keeps the code step through a refused resend, and says why", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      render(h(CodeConfirmation, { address: ADDRESS, istInhaber: () => Promise.resolve(true), onConfirmed: () => undefined }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Code per E-Mail senden" }));
      });
      await act(answered);
      await act(async () => {
        mock.timers.tick(30_000);
      });

      answerWith(() => Promise.resolve({ success: false, error: KONTO_FORBIDDEN }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Code erneut senden" }));
      });
      await act(answered);
    } finally {
      mock.timers.reset();
    }

    assert.ok(screen.queryByLabelText("Code aus der E-Mail"), "the refused resend took the code step down");
    assert.deepEqual(
      raised.map(({ title, description }) => ({ title, description })),
      [{ title: "Code nicht gesendet", description: KONTO_FORBIDDEN }],
    );
  });
});

describe("a code that confirmed somebody other than the page's holder", () => {
  it("hands the focus to the control that sends the next code", async () => {
    const user = userEvent.setup();
    render(h(CodeConfirmation, { address: ADDRESS, istInhaber: () => Promise.resolve(false), onConfirmed: () => undefined }));

    await user.click(screen.getByRole("button", { name: "Code per E-Mail senden" }));
    await act(answered);
    const field = await screen.findByLabelText<HTMLInputElement>("Code aus der E-Mail");
    fetchMock.mock.mockImplementationOnce(() =>
      Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } })),
    );
    await user.type(field, "048213");
    await act(fetchMock.answered);
    await screen.findByRole("alert");

    // `ok` rather than `equal` on an element: a failure's report inspects both sides, and a jsdom node holds the whole window.
    // Waited for: the focus moves once the replaced field has gone, which a loaded machine commits after its alert.
    await waitFor(() =>
      assert.ok(
        document.activeElement === screen.getByRole("button", { name: "Code per E-Mail senden" }),
        "the refusal replaced the code field and the focus fell to the page",
      ),
    );
  });
});
