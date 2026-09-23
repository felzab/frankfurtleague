import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";

const BUS = "__flPasskeyModalCeremonies";

/* The browser's own credential calls, replaced at the module boundary: this runner has no
   `navigator.credentials`, and a test-only prop would be a seam in production code. */
const CLIENT_DOUBLE = `export const authClient = {
  passkey: { addPasskey: () => globalThis.${BUS}.run("addPasskey") },
  signIn: { passkey: () => globalThis.${BUS}.run("signInPasskey") },
};`;

registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/authClient.ts")) return { format: "module", source: CLIENT_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

/** Which ceremony the dialog reached for, in order; the double reads this through the global. */
const reached: string[] = [];

/** What the next ceremony answers. Better Auth reports a cancelled prompt on `error`, never by throwing. */
let answer: () => Promise<unknown> = () => Promise.resolve({ data: {}, error: null });

Reflect.set(globalThis, BUS, {
  run: (name: string) => {
    reached.push(name);
    return answer();
  },
});

const EINTRAEGE = [
  { id: "eins", createdAt: "2026-01-15T22:30:00.000Z", label: "Windows Hello" },
  { id: "zwei", createdAt: "2026-02-01T09:00:00.000Z", label: null },
];

let listed = { passkeys: EINTRAEGE, kannHinzufuegen: true };

/** What the plugin's client hands back for the loser of two changes at once. */
const CONFLICT = { code: "PASSKEY_ENROLMENT_CONFLICT", message: "x", status: 409, statusText: "CONFLICT" };

const { calls, answerWith } = doubleActions({
  modules: [/\/features\/passkeys\/actions\.ts$/],
  answer: () => Promise.resolve({ success: true, message: "Gespeichert.", ...listed }),
});
const { raised } = doubleToasts();

const { PasskeyModal } = await import("./PasskeyModal.tsx");

function open() {
  return render(h(PasskeyModal, { isOpen: true, onClose: () => undefined }));
}

/** The words on a control, which is what a reader acts on and what speech input finds it by. */
const controls = (): string[] => screen.getAllByRole("button").map((control) => control.textContent ?? "");

beforeEach(() => {
  reached.length = 0;
  calls.length = 0;
  raised.length = 0;
  listed = { passkeys: EINTRAEGE, kannHinzufuegen: true };
  answerWith(() => Promise.resolve({ success: true, message: "Gespeichert.", ...listed }));
  answer = () => Promise.resolve({ data: {}, error: null });
});

describe("what the dialog puts in front of the administrator", () => {
  /* The AAGUID names a MODEL and every privacy-preserving platform reports the all-zero one, so a
     row with no make is the ordinary case rather than the edge one. */
  it("names each passkey by the make its authenticator reported, and the rest by one placeholder", async () => {
    open();

    assert.ok(await screen.findByText("Windows Hello"));
    assert.ok(screen.getByText("Unbekannter Passkey"));
  });

  /* The enrolment date is the only thing parting two rows of one make, so it is never conditional. */
  it("dates every row in the reader's own zone", async () => {
    open();

    assert.ok(await screen.findByText("15. Januar 2026 um 23:30"));
    assert.ok(screen.getByText("1. Februar 2026 um 10:00"));
  });

  /* The cap's own sentence, which names the way forward rather than the number it refuses at: the
     server refuses the sixth enrolment either way, and a refused browser prompt says nothing. */
  it("closes the add control at the cap, saying to delete one first", async () => {
    listed = { passkeys: EINTRAEGE, kannHinzufuegen: false };
    open();

    await screen.findByText("Windows Hello");
    assert.ok(screen.getByText("Mehr Passkeys gehen nicht. Lösche zuerst einen."));
  });

  /* The flag's own initial value is the closed one, so a reason read before the list lands announces
     a cap nothing has judged — on every opening, and after a read that failed. */
  it("announces no cap while the list is still being read", async () => {
    answerWith(() => new Promise(() => undefined));
    open();

    assert.ok(screen.queryByText("Mehr Passkeys gehen nicht. Lösche zuerst einen.") === null);
    assert.ok(screen.queryByText("Windows Hello") === null, "the list resolved, so this case proves nothing");
  });
});

describe("the step-up both writes take", () => {
  /* A cookie alone may neither add nor remove: the assertion mints a session whose `createdAt` is
     now, and an authenticator this account never enrolled is answered 401 by the server. */
  it("asserts before it enrols, in that order", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText("Windows Hello");

    await user.click(screen.getByRole("button", { name: "Passkey hinzufügen" }));

    assert.deepEqual(reached, ["signInPasskey", "addPasskey"]);
  });

  it("enrols nothing where the assertion did not complete, and says so", async () => {
    const user = userEvent.setup();
    answer = () => Promise.resolve({ data: null, error: { message: "cancelled", status: 400, statusText: "BAD_REQUEST" } });
    open();
    await screen.findByText("Windows Hello");

    await user.click(screen.getByRole("button", { name: "Passkey hinzufügen" }));

    assert.deepEqual(reached, ["signInPasskey"], "the enrolment ran on a session that never asserted");
    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title]),
      [["danger", "Passkey nicht hinzugefügt"]],
    );
  });

  /* The other change's row belongs on the list, and at the cap it closes the add control: left unread,
     the dialog offers a press the server then refuses (`docs/frontend/spec.md :: I341`). */
  it("words the loser of two changes at once as a retry and re-reads the list", async () => {
    const user = userEvent.setup();
    answer = () => (reached.length === 1 ? Promise.resolve({ data: {}, error: null }) : Promise.resolve({ data: null, error: CONFLICT }));
    open();
    await screen.findByText("Windows Hello");

    await user.click(screen.getByRole("button", { name: "Passkey hinzufügen" }));

    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title, toast.description]),
      [["danger", "Passkey nicht hinzugefügt", "Gleichzeitig wurde ein anderer Passkey hinzugefügt oder gelöscht. Versuche es noch einmal."]],
    );
    assert.deepEqual(
      calls.map((call) => call.action),
      ["readPasskeysAction", "readPasskeysAction"],
    );
  });

  /* A retry would meet the cap the other enrolment reached, so the toast says what the re-read list
     already shows. */
  it("names the cap when the re-read after a conflict finds it reached", async () => {
    const user = userEvent.setup();
    answer = () => (reached.length === 1 ? Promise.resolve({ data: {}, error: null }) : Promise.resolve({ data: null, error: CONFLICT }));
    open();
    await screen.findByText("Windows Hello");
    listed = { passkeys: EINTRAEGE, kannHinzufuegen: false };

    await user.click(screen.getByRole("button", { name: "Passkey hinzufügen" }));

    assert.deepEqual(
      raised.map((toast) => toast.description),
      ["Gleichzeitig wurde ein anderer Passkey hinzugefügt. Mehr Passkeys gehen nicht. Lösche zuerst einen."],
    );
  });

  /* An enrolment another device finished first earns the guard's plain refusal, and leaves the list
     as stale as the conflict does. */
  it("re-reads the list when the enrolment is refused outright, and names the cap it finds", async () => {
    const user = userEvent.setup();
    answer = () =>
      reached.length === 1
        ? Promise.resolve({ data: {}, error: null })
        : Promise.resolve({ data: null, error: { message: "Not Found", status: 404, statusText: "NOT_FOUND" } });
    open();
    await screen.findByText("Windows Hello");
    listed = { passkeys: EINTRAEGE, kannHinzufuegen: false };

    await user.click(screen.getByRole("button", { name: "Passkey hinzufügen" }));

    assert.deepEqual(
      raised.map((toast) => toast.description),
      ["Mehr Passkeys gehen nicht. Lösche zuerst einen."],
    );
    assert.deepEqual(
      calls.map((call) => call.action),
      ["readPasskeysAction", "readPasskeysAction"],
    );
  });

  /* A refused removal may answer a list another change moved, so the list is read again rather than
     left offering a row that is gone (`docs/frontend/spec.md :: I312`). */
  it("re-reads the list after the server refuses a removal", async (t) => {
    const user = userEvent.setup();
    answerWith(() =>
      calls.at(-1)?.action === "removePasskeyAction"
        ? Promise.resolve({
            success: false,
            error: "Gleichzeitig wurde an Deinen Passkeys oder Anmeldungen etwas geändert. Lade die Seite neu.",
          })
        : Promise.resolve({ success: true, message: "Gespeichert.", ...listed }),
    );
    open();
    await screen.findByText("Windows Hello");
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });

    await user.click(screen.getAllByRole("button", { name: "Löschen" })[0]!);
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: "Ja, Passkey löschen" }));

    assert.deepEqual(
      calls.map((call) => call.action),
      ["readPasskeysAction", "removePasskeyAction", "readPasskeysAction"],
    );
    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title, toast.description]),
      [["danger", "Passkey nicht gelöscht", "Gleichzeitig wurde an Deinen Passkeys oder Anmeldungen etwas geändert. Lade die Seite neu."]],
    );
  });

  it("asserts before it deletes, and only on the second press", async (t) => {
    const user = userEvent.setup();
    open();
    await screen.findByText("Windows Hello");

    // The shared hook ignores a second press inside its double-click window, which two scripted
    // clicks always land in: the clock is moved past it so this is two decisions rather than one.
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });

    await user.click(screen.getAllByRole("button", { name: "Löschen" })[0]!);

    assert.deepEqual([reached, calls.map((call) => call.action)], [[], ["readPasskeysAction"]], "one press deleted a passkey");
    assert.ok(screen.getByText("Bist Du Dir sicher?"), "the first press armed nothing");

    t.mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: "Ja, Passkey löschen" }));

    assert.deepEqual(reached, ["signInPasskey"]);
    assert.deepEqual(
      calls.map((call) => call.action),
      ["readPasskeysAction", "removePasskeyAction", "readPasskeysAction"],
    );
    assert.deepEqual(calls[1]?.payload, "eins");
  });
});

describe("what the armed state tells the reader a deletion costs", () => {
  /* Ending the other sessions is not derivable from a control labelled „Löschen“, and it reaches
     the reader's other devices rather than the one they are holding. */
  it("names the other devices being signed out, in the armed reveal", async () => {
    const user = userEvent.setup();
    open();
    await screen.findByText("Windows Hello");

    await user.click(screen.getAllByRole("button", { name: "Löschen" })[0]!);

    assert.ok(screen.getByText("Dieser Passkey wird gelöscht. Alle anderen Geräte werden dabei abgemeldet."));
  });

  /* The last ROW, refused on the page as well as in the action: a control that opens a prompt the
     server then refuses spends the reader's authenticator for nothing. */
  it("closes the deletion on the only row an administrator holds", async () => {
    listed = { passkeys: [EINTRAEGE[0]!], kannHinzufuegen: true };
    open();

    await screen.findByText("Windows Hello");
    assert.ok(screen.getByText("Der letzte Passkey lässt sich nicht löschen."));
    assert.deepEqual(controls().includes("Ja, Passkey löschen"), false);
  });
});
