import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { KONTAKT_EMAIL } from "@/core/brand.ts";
import { doubleToasts } from "@/shared/testing/actionDoubles.ts";

const BUS = "__flPasskeySignIn";

/* The browser's own credential calls, replaced at the module boundary: this runner has no
   `navigator.credentials`, and a test-only prop would be a seam in production code. */
const CLIENT_DOUBLE = `export const authClient = {
  signIn: { passkey: (options) => globalThis.${BUS}.run(options) },
};`;

/* A full document navigation, which jsdom does not implement. */
const NAVIGATION_DOUBLE = `export function leaveDocumentFor(path) { globalThis.${BUS}.left.push(path); }`;

registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/src/core/authClient.ts")) return { format: "module", source: CLIENT_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/shared/utils/documentNavigation.ts")) return { format: "module", source: NAVIGATION_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { raised } = doubleToasts();

/** What each ceremony was started with, in order. */
const calls: unknown[] = [];

/** Answers handed out in order; past the end, a ceremony stays pending, as an armed autofill does. */
const answers: (() => Promise<unknown>)[] = [];

const left: string[] = [];

Reflect.set(globalThis, BUS, {
  left: left,
  run: (options: unknown) => {
    calls.push(options);
    return (answers.shift() ?? (() => new Promise(() => undefined)))();
  },
});

/** Whether the browser offers passkeys in an address field; jsdom has no `PublicKeyCredential` at all. */
let autofill = true;
Reflect.set(globalThis, "PublicKeyCredential", { isConditionalMediationAvailable: () => Promise.resolve(autofill) });

const { PasskeySignIn } = await import("./PasskeySignIn.tsx");

const AUTOFILL = { autoFill: true, returnWebAuthnResponse: true };
const LANDING = "/signin/weiter";

const aborted = () => Promise.resolve({ data: null, error: { code: "ERROR_CEREMONY_ABORTED", status: 400 } });
const signedIn = () => Promise.resolve({ data: { status: true }, error: null });

/** A passkey the reader picked and the server refused, which carries the browser's response back. */
const refusedAfterPicking = (code: string) => () =>
  Promise.resolve({ data: null, error: { code: code, status: 400 }, webauthn: { response: {}, clientExtensionResults: {} } });

beforeEach(() => {
  calls.length = 0;
  answers.length = 0;
  left.length = 0;
  raised.length = 0;
  autofill = true;
});

describe("the passkey the browser offers in the address field", () => {
  it("arms the autofill once the browser says it offers one", async () => {
    render(h(PasskeySignIn));

    await waitFor(() => assert.deepEqual(calls, [AUTOFILL]));
  });

  /* The options call writes a challenge row and a cookie before the browser refuses, so an
     unsupported browser would pay both on every view of the page. */
  it("asks the server nothing where the browser offers no autofill", async () => {
    autofill = false;
    render(h(PasskeySignIn));

    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(calls, []);
  });

  it("leaves the document for the landing when the offered passkey signs in", async () => {
    answers.push(signedIn);
    render(h(PasskeySignIn));

    await waitFor(() => assert.deepEqual(left, [LANDING]));
  });

  /* Nothing was picked, so there is nothing to report, and arming again would repeat whatever
     ended the request without end. */
  it("says nothing and stays quiet when the request ends with nothing picked", async () => {
    answers.push(aborted);
    render(h(PasskeySignIn));

    await waitFor(() => assert.equal(calls.length, 1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual([calls.length, raised, left], [1, [], []]);
  });

  /* A request the browser answered is spent: unarmed again, the field offers nothing until a reload. */
  it("reports a passkey the server refused and arms the field again", async () => {
    answers.push(refusedAfterPicking("USER_VERIFICATION_REQUIRED"));
    render(h(PasskeySignIn));

    await waitFor(() => assert.deepEqual(calls, [AUTOFILL, AUTOFILL]));
    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title, toast.description]),
      [
        [
          "danger",
          "Nicht angemeldet",
          "Dieser Passkey hat nicht bestätigt, dass Du es bist. Nimm einen Passkey mit PIN, Fingerabdruck oder Gesichtserkennung.",
        ],
      ],
    );
  });
});

describe("the button", () => {
  it("starts the ceremony without the autofill and leaves for the landing when it signs in", async () => {
    const user = userEvent.setup();
    autofill = false;
    answers.push(signedIn);
    render(h(PasskeySignIn));

    await user.click(screen.getByRole("button", { name: "Mit Passkey anmelden" }));

    assert.deepEqual(calls, [undefined]);
    assert.deepEqual(left, [LANDING]);
  });

  /* Pressed while the autofill is armed: the press aborts that request, which answers aborted and must
     read as nothing, since the reader is in the middle of the press. */
  it("swallows the abort the press itself causes, and a pressed ceremony another aborted", async () => {
    const user = userEvent.setup();
    autofill = false;
    answers.push(aborted);
    render(h(PasskeySignIn));

    await user.click(screen.getByRole("button", { name: "Mit Passkey anmelden" }));

    assert.deepEqual(raised, []);
    assert.equal(calls.length, 1, "an aborted press armed the autofill again");
  });

  it("reports a refused press, offers the button again and arms the field again", async () => {
    const user = userEvent.setup();
    render(h(PasskeySignIn));
    // Armed on mount and left pending, as a field nobody has touched is.
    await waitFor(() => assert.deepEqual(calls, [AUTOFILL]));

    answers.push(() => Promise.resolve({ data: null, error: { code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", status: 400 } }));
    await user.click(screen.getByRole("button", { name: "Mit Passkey anmelden" }));

    await waitFor(() => assert.deepEqual(calls.slice(1), [undefined, AUTOFILL]));
    assert.deepEqual(
      raised.map((toast) => [toast.title, toast.description]),
      [["Nicht angemeldet", "Versuche es noch einmal."]],
    );
    assert.ok(screen.getByRole("button", { name: "Mit Passkey anmelden" }));
  });

  /* The gate at session creation names its reason, and a retry would meet it again: the ban is named
     plainly, and an address holding nothing gets the way to ask. */
  it("words the gate's two refusals as themselves, and a backend that did not answer as a retry", async () => {
    const user = userEvent.setup();
    autofill = false;
    const refusedWith = (code: string, status: number) => () => Promise.resolve({ data: null, error: { code: code, status: status } });
    answers.push(refusedWith("SIGN_IN_BARRED", 403), refusedWith("SIGN_IN_HOLDS_NOTHING", 403), refusedWith("SERVICE_UNAVAILABLE", 503));
    render(h(PasskeySignIn));

    for (let press = 0; press < 3; press += 1) await user.click(screen.getByRole("button", { name: "Mit Passkey anmelden" }));

    assert.deepEqual(
      raised.map((toast) => toast.description),
      [
        "Diese E-Mail-Adresse ist gesperrt. Solange die Sperre gilt, ist keine Anmeldung möglich.",
        `Mit dieser Adresse ist derzeit keine Anmeldung möglich. Wenn Du das für einen Fehler hältst, schreib uns an ${KONTAKT_EMAIL}.`,
        "Versuche es noch einmal.",
      ],
    );
  });

  it("reports a rejected ceremony rather than leaving the pending label standing", async () => {
    const user = userEvent.setup();
    autofill = false;
    answers.push(() => Promise.reject(new TypeError("Failed to fetch")));
    render(h(PasskeySignIn));

    await user.click(screen.getByRole("button", { name: "Mit Passkey anmelden" }));

    assert.ok(screen.getByRole("button", { name: "Mit Passkey anmelden" }));
    assert.deepEqual(
      raised.map((toast) => toast.title),
      ["Nicht angemeldet"],
    );
  });
});
