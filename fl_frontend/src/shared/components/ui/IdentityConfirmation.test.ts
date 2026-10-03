import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { registerDoubles } from "@/core/exportingModule.ts";
import { answersInFlight } from "@/shared/testing/answersInFlight.ts";

/** The ceremony's and the holder check's answers, awaited before a case polls for what they decide. */
const answers = answersInFlight();

/* The browser's own credential call, replaced at the module boundary: this runner has no
   `navigator.credentials`, and a test-only prop would be a seam in production code. */
const CLIENT_DOUBLE = { authClient: { signIn: { passkey: () => answers.track("signIn.passkey", ceremony()) } } };

registerDoubles({
  modules: {
    "core/authClient.ts": CLIENT_DOUBLE,
  },
});

/** What the assertion answers. Better Auth reports a failed ceremony on `error`, never by throwing. */
let ceremony: () => Promise<unknown> = () => Promise.resolve({ data: {}, error: null });

const { IdentityConfirmation } = await import("./IdentityConfirmation.tsx");

const STEP_UP_REFUSED = "Wir konnten Dich nicht mit einem Passkey bestätigen.";

/** What the holder check was asked, and what it answers. */
let asked = 0;
let holder: () => Promise<boolean> = () => Promise.resolve(true);
let confirmed = 0;

function open(codeHalf: string | null = null, hasPasskey = true) {
  render(
    h(IdentityConfirmation, {
      hinweis: "Warum wir fragen.",
      hasPasskey: hasPasskey,
      codeHalf: codeHalf,
      istInhaber: () => ((asked += 1), answers.track("istInhaber", holder())),
      onConfirmed: () => void (confirmed += 1),
    }),
  );
}

async function press(): Promise<void> {
  await userEvent.setup().click(screen.getByRole("button", { name: "Mit Passkey bestätigen" }));
  await act(answers.answered);
}

beforeEach(() => {
  ceremony = () => Promise.resolve({ data: {}, error: null });
  holder = () => Promise.resolve(true);
  asked = 0;
  confirmed = 0;
});

describe("the confirmation by passkey", () => {
  it("confirms once the assertion signed the page's holder in", async () => {
    open();
    await press();

    await waitFor(() => assert.equal(confirmed, 1));
    assert.equal(asked, 1);
    assert.ok(screen.queryByRole("alert") === null);
  });

  /* Once the page's session has ended, the challenge names nobody and another account's passkey signs
     that account in (`docs/frontend/spec.md :: I428`). */
  it("refuses an assertion that signed another account in", async () => {
    holder = () => Promise.resolve(false);
    open();
    await press();

    await waitFor(() => assert.ok(screen.getByRole("alert").textContent?.includes(STEP_UP_REFUSED)));
    assert.equal(confirmed, 0);
  });

  it("refuses where the holder check never came back", async () => {
    holder = () => Promise.reject(new Error("the request was cut"));
    open();
    await press();

    await waitFor(() => assert.ok(screen.getByRole("alert").textContent?.includes(STEP_UP_REFUSED)));
    assert.equal(confirmed, 0);
  });

  it("refuses a failed assertion without asking whose it was", async () => {
    ceremony = () => Promise.resolve({ data: null, error: { code: "ERROR_CEREMONY_ABORTED", status: 400 } });
    open();
    await press();

    await waitFor(() => assert.ok(screen.getByRole("alert").textContent?.includes(STEP_UP_REFUSED)));
    assert.deepEqual([asked, confirmed], [0, 0]);
  });

  it("clears the refusal on the next press that confirms", async () => {
    ceremony = () => Promise.resolve({ data: null, error: { code: "ERROR_CEREMONY_ABORTED", status: 400 } });
    open();
    await press();
    await screen.findByRole("alert");

    ceremony = () => Promise.resolve({ data: {}, error: null });
    await press();

    await waitFor(() => assert.equal(confirmed, 1));
    assert.ok(screen.queryByRole("alert") === null);
  });

  it("draws the caller's code half beside the passkey's", () => {
    open("Code per E-Mail senden");

    assert.ok(screen.getByText("Code per E-Mail senden"));
    assert.ok(screen.getByRole("button", { name: "Mit Passkey bestätigen" }));
  });

  /* A holder with no passkey would press a prompt no authenticator of theirs can answer. */
  it("offers the code half alone to a holder holding no passkey", () => {
    open("Code per E-Mail senden", false);

    assert.ok(screen.getByText("Code per E-Mail senden"));
    assert.ok(screen.queryByRole("button", { name: "Mit Passkey bestätigen" }) === null);
  });
});
