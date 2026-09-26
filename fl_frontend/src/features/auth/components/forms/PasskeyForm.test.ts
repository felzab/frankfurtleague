import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { KONTAKT_EMAIL } from "@/core/brand.ts";
import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";

const BUS = "__flPasskeyCeremonies";

/* The browser's own credential calls, replaced at the module boundary: this runner has no
   `navigator.credentials`, and a test-only prop would be a seam in production code. */
const CLIENT_DOUBLE = `export const authClient = {
  passkey: { addPasskey: (options) => globalThis.${BUS}.run("addPasskey", options) },
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

/** What each enrolment asked the library for. */
const asked: unknown[] = [];

/** What the next ceremony answers. Better Auth reports a cancelled prompt on `error`, never by throwing. */
let answer: () => Promise<unknown> = () => Promise.resolve({ data: {}, error: null });

/** Every path the card left the document for. */
const left: string[] = [];

Reflect.set(globalThis, BUS, {
  left: left,
  run: (name: string, options?: unknown) => {
    reached.push(name);
    if (name === "addPasskey") asked.push(options);
    return answer();
  },
});

const { PasskeyForm } = await import("./PasskeyForm.tsx");

const ADDRESS = "vorstand@example.org";
const LANDING = "/signin/weiter";

const { router, seen } = recordingRouter();

/** Where the offer's „Später“ goes. */
const LATER = "/bereich";

function renderCard(step: "enrol" | "assert" | "offer") {
  const props =
    step === "offer" ? { step: step, address: ADDRESS, next: LANDING, later: LATER } : { step: step, address: ADDRESS, next: LANDING };
  return render(underNext(h(PasskeyForm, props), { router }));
}

beforeEach(() => {
  reached.length = 0;
  asked.length = 0;
  raised.length = 0;
  left.length = 0;
  seen.replaced.length = 0;
  seen.pushed.length = 0;
  seen.refresh = 0;
  answer = () => Promise.resolve({ data: {}, error: null });
});

describe("which ceremony the card runs", () => {
  /* The guard decides the step and the card obeys it: an enrolment offered to a code-borne session
     that already holds one is refused by the server (`docs/frontend/spec.md :: I261`). */
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

  /* Setting the passkey up signs in with it, so the card asks for no second press: one enrolment,
     and the landing decides where the new session goes. */
  it("signs in with the passkey it sets up, and leaves the document for the landing, on both enrolling steps", async () => {
    const user = userEvent.setup();

    for (const step of ["enrol", "offer"] as const) {
      const { unmount } = renderCard(step);
      await user.click(screen.getByRole("button", { name: "Jetzt einrichten" }));
      unmount();
    }

    assert.deepEqual(asked, [{ createSession: true }, { createSession: true }], "an enrolment left the code's session standing");
    assert.deepEqual(left, [LANDING, LANDING]);
    assert.deepEqual([seen.refresh, seen.replaced], [0, []]);
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
  /* The enrolment ends signed in on the surface the reader was after, as the assertion does. */
  it("says nothing when the enrolment works, the page it lands on being the answer", async () => {
    const user = userEvent.setup();
    renderCard("enrol");

    await user.click(screen.getByRole("button", { name: "Jetzt einrichten" }));

    assert.deepEqual(raised, []);
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

    assert.deepEqual([seen.replaced, left, seen.refresh], [[], [], 0], "a refused ceremony sent the reader on");
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

  /* The other enrolment stands, and the guard then offers the assertion: left unread, the card offers
     an enrolment the server refuses on every retry (`docs/frontend/spec.md :: I341`). */
  it("tells the loser of two enrolments at once that a passkey now exists, and re-reads its own page", async () => {
    const user = userEvent.setup();
    answer = () =>
      Promise.resolve({ data: null, error: { code: "PASSKEY_ENROLMENT_CONFLICT", message: "x", status: 409, statusText: "CONFLICT" } });
    renderCard("enrol");

    await user.click(screen.getByRole("button", { name: "Jetzt einrichten" }));

    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title, toast.description]),
      [
        [
          "danger",
          "Passkey nicht eingerichtet",
          "Für diesen Zugang wurde gerade ein anderer Passkey eingerichtet. Melde Dich jetzt mit ihm an. " +
            `Hast Du keinen zweiten eingerichtet, schreib an ${KONTAKT_EMAIL}; wir löschen dann alle Passkeys dieses Zugangs.`,
        ],
      ],
    );
    assert.deepEqual([seen.refresh, seen.replaced, left], [1, [], []]);
  });

  /* An enrolment another tab finished first earns the guard's plain refusal rather than the conflict,
     and leaves the card as stale. */
  it("re-reads its own page when the enrolment is refused outright", async () => {
    const user = userEvent.setup();
    answer = () => Promise.resolve({ data: null, error: { message: "Not Found", status: 404, statusText: "NOT_FOUND" } });
    renderCard("enrol");

    await user.click(screen.getByRole("button", { name: "Jetzt einrichten" }));

    assert.deepEqual(
      raised.map((toast) => toast.description),
      ["Versuche es noch einmal."],
    );
    assert.deepEqual([seen.refresh, seen.replaced, left], [1, [], []]);
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

  /* Removal lives behind a fresh assertion, in the sidemenu's dialog. A session that could remove
     its own passkey here is one a stolen mailbox could swap a passkey on. */
  it("offers one control and no second one that deletes a passkey", () => {
    renderCard("assert");

    assert.deepEqual(
      screen.getAllByRole("button").map((control) => control.textContent),
      ["Jetzt anmelden"],
    );
  });

  /* An administrator's passkey is required, so their card has no way past it: „Später“ there would
     land on the landing, which sends them straight back. */
  it("gives the offer a way past it and the administrator's required enrolment none", () => {
    const { unmount } = renderCard("enrol");
    assert.deepEqual(
      screen.getAllByRole("button").map((control) => control.textContent),
      ["Jetzt einrichten"],
    );
    unmount();

    renderCard("offer");
    assert.deepEqual(
      screen.getAllByRole("button").map((control) => control.textContent),
      ["Jetzt einrichten", "Später"],
    );
  });

  it("explains a passkey on the offer, where the reader meets one for the first time", () => {
    renderCard("offer");

    assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "Passkey einrichten");
    for (const sentence of [
      "Mit einem Passkey meldest Du Dich künftig ohne Code an, mit Fingerabdruck, Gesicht oder der Displaysperre Deines Geräts.",
      "Was ist ein Passkey? Ein digitaler Schlüssel, den Dein Gerät sicher speichert.",
      "Wo wird er gespeichert? In Deinem Passwortmanager, zum Beispiel im iCloud-Schlüsselbund oder im Google Passwortmanager, damit Du Dich auch auf Deinen anderen Geräten anmelden kannst.",
      "Richte ihn nur auf Deinem eigenen Gerät ein.",
    ])
      assert.ok(screen.getByText(sentence));
  });

  /* The session is unchanged by „Später“, so a soft navigation is right, and it goes past the
     landing, which would offer the passkey again. */
  it("sends „Später“ to the destination the page named, running no ceremony", async () => {
    const user = userEvent.setup();
    renderCard("offer");

    await user.click(screen.getByRole("button", { name: "Später" }));

    assert.deepEqual(seen.pushed, [LATER]);
    assert.deepEqual([reached, left], [[], []]);
  });
});
