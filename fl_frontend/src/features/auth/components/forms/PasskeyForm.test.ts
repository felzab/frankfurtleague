import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";

const BUS = "__flPasskeyCeremonies";

/* The browser's own credential calls, replaced at the module boundary: this runner has no
   `navigator.credentials`, and a test-only prop would be a seam in production code. */
const CLIENT_DOUBLE = `export const authClient = {
  passkey: { addPasskey: () => globalThis.${BUS}.run("addPasskey") },
  signIn: { passkey: () => globalThis.${BUS}.run("signInPasskey") },
};`;

/* A full document navigation, which jsdom does not implement and whose `location` no test can
   replace: recorded at the same module boundary the credential calls are. */
const NAVIGATION_DOUBLE = `export function leaveDocumentFor(path) { globalThis.${BUS}.left.push(path); }`;

registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/authClient.ts")) return { format: "module", source: CLIENT_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/shared/utils/documentNavigation.ts")) return { format: "module", source: NAVIGATION_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { raised } = doubleToasts();

/** Which ceremony the card reached for, in order; the double reads this through the global. */
const reached: string[] = [];

/** What the next ceremony answers. Better Auth reports a cancelled prompt on `error`, never by throwing. */
let answer: () => Promise<unknown> = () => Promise.resolve({ data: {}, error: null });

/** Every path the card left the document for. */
const left: string[] = [];

Reflect.set(globalThis, BUS, {
  left: left,
  run: (name: string) => {
    reached.push(name);
    return answer();
  },
});

const { PasskeyForm } = await import("./PasskeyForm.tsx");

const ADDRESS = "vorstand@example.org";
const LANDING = "/signin/weiter";

const { router, seen } = recordingRouter();

function renderCard(step: "enrol" | "assert") {
  return render(underNext(h(PasskeyForm, { step: step, address: ADDRESS, next: LANDING }), { router }));
}

beforeEach(() => {
  reached.length = 0;
  raised.length = 0;
  left.length = 0;
  seen.replaced.length = 0;
  seen.refresh = 0;
  answer = () => Promise.resolve({ data: {}, error: null });
});

describe("which ceremony the card runs", () => {
  /* The guard decides the step and the card obeys it: an enrolment offered to somebody who already
     holds a passkey enrols a second one, which `docs/frontend/spec.md :: I261` refuses. */
  it("enrols on the step the guard asked to enrol, and signs in on the step it asked to assert", async () => {
    const user = userEvent.setup();
    const { unmount } = renderCard("enrol");

    await user.click(screen.getByRole("button", { name: "Jetzt einrichten" }));
    assert.deepEqual(reached, ["addPasskey"]);
    unmount();

    reached.length = 0;
    renderCard("assert");
    await user.click(screen.getByRole("button", { name: "Jetzt anmelden" }));
    assert.deepEqual(reached, ["signInPasskey"]);
  });

  /* The enrolment leaves the link-borne session standing, so this same page is what offers the
     assertion next: re-read, the guard answers the other step, and the toast above it survives. */
  it("re-reads its own page after an enrolment, and goes nowhere", async () => {
    const user = userEvent.setup();
    renderCard("enrol");

    await user.click(screen.getByRole("button", { name: "Jetzt einrichten" }));

    assert.equal(seen.refresh, 1, "the card still offers the enrolment the reader has just completed");
    assert.deepEqual([seen.replaced, left], [[], []]);
    assert.ok(screen.getByRole("button", { name: "Jetzt einrichten" }), "the control stayed pending over a page that re-renders under it");
  });

  /* The assertion replaces the session, so this page's own guard now redirects: a refresh racing a
     soft navigation left the reader on the landing for good. One document load decides once. */
  it("leaves the document for the landing after an assertion, racing no refresh against it", async () => {
    const user = userEvent.setup();
    renderCard("assert");

    await user.click(screen.getByRole("button", { name: "Jetzt anmelden" }));

    assert.deepEqual(left, [LANDING]);
    assert.deepEqual([seen.refresh, seen.replaced], [0, []]);
  });
});

describe("what the reader is told when the step worked", () => {
  /* The enrolment lands them back on this same card, asking for a second ceremony: silent, that
     reads as the press having failed, and the danger title is the only thing the card ever said. */
  it("confirms an enrolment and names the step the reader is being sent to", async () => {
    const user = userEvent.setup();
    renderCard("enrol");

    await user.click(screen.getByRole("button", { name: "Jetzt einrichten" }));

    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title, toast.description]),
      [["success", "Passkey eingerichtet", "Melde Dich jetzt damit an."]],
    );
  });

  /* The assertion ends on the surface the reader was after, which says where they are: a toast over
     it would confirm what the page they just reached already shows. */
  it("says nothing when the assertion works, the admin surface being the answer", async () => {
    const user = userEvent.setup();
    renderCard("assert");

    await user.click(screen.getByRole("button", { name: "Jetzt anmelden" }));

    assert.deepEqual(raised, []);
    assert.deepEqual(left, [LANDING]);
  });
});

describe("two presses on one control", () => {
  /* A second browser prompt aborts the first, which the card then reports as a refused ceremony —
     on a press the reader made while the first prompt was still open. */
  it("runs one ceremony however often the control is pressed while it is running", async () => {
    const user = userEvent.setup();
    answer = () => new Promise(() => undefined);
    renderCard("enrol");

    const control = screen.getByRole("button", { name: "Jetzt einrichten" });
    await user.click(control);
    await user.click(screen.getByRole("button", { name: "Richtet ein..." }));

    assert.deepEqual(reached, ["addPasskey"]);
  });
});

describe("a prompt the browser did not complete", () => {
  /* Cancelled, refused or unanswered, the reader meets one wording and the control they pressed. */
  it("says the step did not happen and offers the control again", async () => {
    const user = userEvent.setup();
    answer = () => Promise.resolve({ data: null, error: { message: "cancelled", status: 400, statusText: "BAD_REQUEST" } });
    renderCard("enrol");

    await user.click(screen.getByRole("button", { name: "Jetzt einrichten" }));

    assert.deepEqual([seen.replaced, left], [[], []], "a refused ceremony sent the reader on");
    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title, toast.description]),
      [["danger", "Passkey nicht eingerichtet", "Versuche es noch einmal."]],
    );
    assert.ok(screen.getByRole("button", { name: "Jetzt einrichten" }), "the control the reader would press again is gone");
  });

  /* The one refusal repeating the same press cannot clear, because the assertion asks for user
     verification rather than demanding it: the browser offers a passkey the server then refuses. */
  it("words a passkey the authenticator did not verify as its own failure", async () => {
    const user = userEvent.setup();
    answer = () =>
      Promise.resolve({ data: null, error: { code: "USER_VERIFICATION_REQUIRED", message: "x", status: 400, statusText: "BAD_REQUEST" } });
    renderCard("assert");

    await user.click(screen.getByRole("button", { name: "Jetzt anmelden" }));

    assert.deepEqual(
      raised.map((toast) => toast.description),
      ["Dieser Passkey hat nicht bestätigt, dass Du es bist. Nimm einen Passkey mit PIN, Fingerabdruck oder Gesichtserkennung."],
    );
  });

  /* Awaited outside a transition, a rejection reaches no error boundary: uncaught it leaves
     „Richtet ein...“ standing for good and says nothing at all. */
  it("reports a rejected ceremony as itself rather than leaving the pending label standing", async () => {
    const user = userEvent.setup();
    answer = () => Promise.reject(new TypeError("Failed to fetch"));
    renderCard("assert");

    await user.click(screen.getByRole("button", { name: "Jetzt anmelden" }));

    assert.ok(screen.getByRole("button", { name: "Jetzt anmelden" }), "the rejected ceremony left the pending label standing");
    assert.deepEqual(
      raised.map((toast) => toast.title),
      ["Nicht angemeldet"],
    );
  });
});

describe("what the card puts in front of the reader", () => {
  /* `docs/frontend/spec.md` §1.16: a person's own datum never sits unmarked in prose, so the address
     the passkey will belong to takes the bold rung rather than the paragraph's. */
  it("marks the signed-in address as the reader's own datum", () => {
    renderCard("enrol");

    assert.match(screen.getByText(ADDRESS).className, /\bfont-bold\b/);
  });

  /* One passkey per administrator, and recovery is the runbook's console step. A session that
     could delete its own passkey is one a stolen mailbox could swap a passkey on. */
  it("offers one control and no second one that deletes a passkey", () => {
    renderCard("assert");

    assert.deepEqual(
      screen.getAllByRole("button").map((control) => control.textContent),
      ["Jetzt anmelden"],
    );
  });
});
