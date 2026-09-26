import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

const BUS = "__flIdentityConfirmationCeremony";

/* The browser's own credential call, replaced at the module boundary: this runner has no
   `navigator.credentials`, and a test-only prop would be a seam in production code. */
const CLIENT_DOUBLE = `export const authClient = { signIn: { passkey: () => globalThis.${BUS}.run() } };`;

registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/authClient.ts")) return { format: "module", source: CLIENT_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

/** What the assertion answers. Better Auth reports a failed ceremony on `error`, never by throwing. */
let ceremony: () => Promise<unknown> = () => Promise.resolve({ data: {}, error: null });
Reflect.set(globalThis, BUS, { run: () => ceremony() });

const { IdentityConfirmation } = await import("./IdentityConfirmation.tsx");

const STEP_UP_REFUSED = "Wir konnten Dich nicht mit einem Passkey bestätigen.";

/** What the holder check was asked, and what it answers. */
let asked = 0;
let holder: () => Promise<boolean> = () => Promise.resolve(true);
let confirmed = 0;

function open(codeHalf: string | null = null) {
  render(
    h(IdentityConfirmation, {
      hinweis: "Warum wir fragen.",
      codeHalf: codeHalf,
      istInhaber: () => ((asked += 1), holder()),
      onConfirmed: () => void (confirmed += 1),
    }),
  );
}

const press = () => userEvent.setup().click(screen.getByRole("button", { name: "Mit Passkey bestätigen" }));

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

  /* The browser offers every account's passkey, and another account's signs that account in
     (`docs/frontend/spec.md :: I454`). */
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
  });
});
