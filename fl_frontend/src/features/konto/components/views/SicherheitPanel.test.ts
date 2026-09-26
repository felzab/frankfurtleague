import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";

import type { Navigations } from "@/shared/testing/nextContexts.ts";
import type { Sicherheit } from "../../types.ts";

const BUS = "__flSicherheitCeremonies";

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

/** Which ceremony the page reached for, in order. */
const reached: string[] = [];

/** What each ceremony answers, by name. Better Auth reports a failed ceremony on `error`, never by throwing. */
const ceremony: Record<string, () => Promise<unknown>> = {};

const SUCCEEDED = () => Promise.resolve({ data: {}, error: null });

Reflect.set(globalThis, BUS, {
  run: (name: string) => {
    reached.push(name);
    return (ceremony[name] ?? SUCCEEDED)();
  },
});

/** Each action's answer, by name; one not named answers a plain success. */
const answers: Record<string, unknown> = {};

const { calls, answerWith } = doubleActions({
  modules: [/\/features\/passkeys\/actions\.ts$/, /\/features\/konto\/actions\.ts$/],
});
const { raised } = doubleToasts();

const { SicherheitPanel } = await import("./SicherheitPanel.tsx");
const { unansweredAction } = await import("@/shared/utils/actionError.ts");

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const STEP_UP_REQUIRED = "Bestätige zuerst, dass Du es bist.";
const STEP_UP_REFUSED = "Wir konnten Dich nicht mit einem Passkey bestätigen.";

/** The spine's refusal for want of a recent sign-in, as the server sends it. */
const STALE = { success: false, error: STEP_UP_REQUIRED, stepUp: true };

/** What the plugin's client hands back for a refusal the enrolment guard answered. */
const refused = (status: number, code?: string) => () =>
  Promise.resolve({ data: null, error: { status: status, statusText: "x", message: "x", ...(code === undefined ? {} : { code: code }) } });

/** One passkey the holder named, and two sign-ins: this device's by code, and another by that passkey. */
const sicherheit = (fields: Partial<Sicherheit> = {}): Sicherheit => ({
  passkeys: [
    { id: "eins", name: "Laptop", anbieter: null, eingerichtetAm: "2026-09-01T08:00:00.000Z", zuletztVerwendetAm: null, diesesGeraet: false },
  ],
  kannHinzufuegen: true,
  anmeldungen: [
    {
      id: "diese",
      diesesGeraet: true,
      angemeldetAm: "2026-09-26T08:00:00.000Z",
      zuletztAktivAm: "2026-09-26T09:00:00.000Z",
      endetSpaetestensAm: "2026-10-26T08:00:00.000Z",
      faktor: { art: "code" },
    },
    {
      id: "andere",
      diesesGeraet: false,
      angemeldetAm: "2026-09-25T08:00:00.000Z",
      zuletztAktivAm: "2026-09-25T09:00:00.000Z",
      endetSpaetestensAm: "2026-10-25T08:00:00.000Z",
      faktor: { art: "passkey", name: "Laptop" },
    },
  ],
  verwaltung: false,
  inhaberId: "inhaber",
  freshUntil: Date.now() + HOUR_MS,
  enrolmentUntil: Date.now() + 4 * MINUTE_MS,
  ...fields,
});

function open(fields: Partial<Sicherheit> = {}): Navigations {
  const { router, seen } = recordingRouter();
  render(underNext(h(SicherheitPanel, { sicherheit: sicherheit(fields) }), { router }));
  return seen;
}

const sent = () => calls.map((call) => [call.action, call.payload]);
const toasts = () => raised.map((toast) => [toast.variant, toast.title, toast.description]);
const dialog = async () => within(await screen.findByRole("dialog"));

beforeEach(() => {
  reached.length = 0;
  calls.length = 0;
  raised.length = 0;
  for (const name of Object.keys(ceremony)) Reflect.deleteProperty(ceremony, name);
  for (const name of Object.keys(answers)) Reflect.deleteProperty(answers, name);
  answerWith(() => Promise.resolve(answers[calls.at(-1)?.action ?? ""] ?? { success: true, message: "Gespeichert." }));
});

describe("a change past the step-up window", () => {
  /* The page asks before it sends, so the change the reader pressed runs once, after the confirmation. */
  it("asks for a confirmation, then runs the change it waited for", async () => {
    const user = userEvent.setup();
    answers.pruefeInhaberAction = { success: true, gleich: true };
    const seen = open({ freshUntil: null, enrolmentUntil: null });

    await user.click(screen.getByRole("button", { name: "Abmelden" }));
    assert.deepEqual(sent(), [], "a change was sent before the confirmation");

    await user.click((await dialog()).getByRole("button", { name: "Mit Passkey bestätigen" }));

    await waitFor(() =>
      assert.deepEqual(sent(), [
        ["pruefeInhaberAction", "inhaber"],
        ["endAnmeldungAction", "andere"],
      ]),
    );
    assert.deepEqual(reached, ["signInPasskey"]);
    assert.ok(seen.refresh >= 1, "the page kept what it drew off the session the confirmation ended");
    await waitFor(() => assert.deepEqual(toasts(), [["success", "Abgemeldet", "Die Anmeldung ist beendet."]]));
  });

  /* The browser offers every account's passkey: one of another account's signs that account in, and
     the waiting change would run as it (`docs/frontend/spec.md :: I428`). */
  it("runs nothing when the confirmation signed another account in, and says so", async () => {
    const user = userEvent.setup();
    answers.pruefeInhaberAction = { success: true, gleich: false };
    open({ freshUntil: null, enrolmentUntil: null });

    await user.click(screen.getByRole("button", { name: "Abmelden" }));
    await user.click((await dialog()).getByRole("button", { name: "Mit Passkey bestätigen" }));

    const panel = await dialog();
    await waitFor(() => assert.ok(panel.getByRole("alert").textContent?.includes(STEP_UP_REFUSED)));
    assert.deepEqual(sent(), [["pruefeInhaberAction", "inhaber"]]);
  });

  it("says a failed confirmation and runs nothing", async () => {
    const user = userEvent.setup();
    ceremony.signInPasskey = refused(400, "ERROR_CEREMONY_ABORTED");
    open({ freshUntil: null, enrolmentUntil: null });

    await user.click(screen.getByRole("button", { name: "Abmelden" }));
    await user.click((await dialog()).getByRole("button", { name: "Mit Passkey bestätigen" }));

    const panel = await dialog();
    await waitFor(() => assert.ok(panel.getByRole("alert").textContent?.includes(STEP_UP_REFUSED)));
    assert.deepEqual(sent(), []);
  });

  /* The page's figure can be late: the server's refusal opens the same confirmation rather than a toast. */
  it("opens the confirmation on the server's own step-up refusal", async () => {
    const user = userEvent.setup();
    answers.endAnmeldungAction = STALE;
    open();

    await user.click(screen.getByRole("button", { name: "Abmelden" }));

    assert.ok((await dialog()).getByRole("button", { name: "Mit Passkey bestätigen" }));
    assert.deepEqual(toasts(), []);
  });

  /* A rename that waited for a confirmation lands after its form's own promise settled: the form
     closes on the landing, not on the press. */
  it("closes the rename form once a rename it waited for lands", async () => {
    const user = userEvent.setup();
    answers.pruefeInhaberAction = { success: true, gleich: true };
    open({ freshUntil: null, enrolmentUntil: null });

    await user.click(screen.getByRole("button", { name: "Umbenennen" }));
    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Mein iPhone");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await user.click((await dialog()).getByRole("button", { name: "Mit Passkey bestätigen" }));

    await waitFor(() => assert.deepEqual(sent().at(-1), ["renamePasskeyAction", "eins"]));
    await waitFor(() => assert.ok(screen.queryByRole("textbox", { name: "Name" }) === null, "the form stayed open over a stored name"));
  });

  it("keeps the rename form open when the rename is refused", async () => {
    const user = userEvent.setup();
    answers.renamePasskeyAction = {
      success: false,
      error: "Gleichzeitig wurde an Deinen Passkeys oder Anmeldungen etwas geändert. Lade die Seite neu.",
    };
    open();

    await user.click(screen.getByRole("button", { name: "Umbenennen" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), " Pro");
    await user.click(screen.getByRole("button", { name: "Speichern" }));

    await waitFor(() => assert.equal(toasts().at(-1)?.[1], "Passkey nicht umbenannt"));
    assert.ok(screen.getByRole("textbox", { name: "Name" }), "a refused rename closed the form");
  });
});

describe("removing a passkey", () => {
  /* The removal ended the session this page ran in, so the page itself has nothing left to show. */
  it("leaves for the sign-in page once the passkey this device signed in with is gone", async (t) => {
    const user = userEvent.setup();
    answers.removePasskeyAction = { success: true, message: "Passkey gelöscht", diesesGeraet: true };
    const seen = open();
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });

    await user.click(screen.getByRole("button", { name: "Löschen" }));
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: "Ja, Passkey löschen" }));

    await waitFor(() => assert.deepEqual(seen.replaced, ["/signin"]));
    assert.deepEqual(sent(), [["removePasskeyAction", "eins"]]);
  });

  it("stays on the page after removing a passkey another device signed in with", async (t) => {
    const user = userEvent.setup();
    answers.removePasskeyAction = { success: true, message: "Passkey gelöscht", diesesGeraet: false };
    const seen = open();
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });

    await user.click(screen.getByRole("button", { name: "Löschen" }));
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: "Ja, Passkey löschen" }));

    await waitFor(() => assert.equal(toasts().at(-1)?.[1], "Passkey gelöscht"));
    assert.deepEqual(seen.replaced, []);
  });
});

describe("adding a passkey", () => {
  /* The sudo pattern: the control is the confirmation until it is confirmed, then the same control adds.
     The browser opens its own prompt only on a fresh press, so the confirmation never adds by itself. */
  it("confirms first past the window, then adds on the next press of the same control", async () => {
    const user = userEvent.setup();
    answers.pruefeInhaberAction = { success: true, gleich: true };
    open({ freshUntil: null, enrolmentUntil: null });

    assert.ok(screen.queryByRole("button", { name: "Passkey hinzufügen" }) === null, "a stale session is offered the enrolment");
    await user.click(screen.getByRole("button", { name: "Mit Passkey bestätigen" }));

    await screen.findByRole("button", { name: "Passkey hinzufügen" });
    assert.deepEqual(reached, ["signInPasskey"], "the confirmation added a passkey by itself");

    await user.click(screen.getByRole("button", { name: "Passkey hinzufügen" }));

    await waitFor(() => assert.deepEqual(reached, ["signInPasskey", "addPasskey"]));
    await waitFor(() => assert.deepEqual(toasts(), [["success", "Passkey hinzugefügt", "Du kannst Dich jetzt auch damit anmelden."]]));
  });

  /* Adding asks a sign-in of the last five minutes, every other change one of the last two hours: a
     session between the two changes a name at once and still confirms before it adds. */
  it("confirms before adding past the enrolment window, while every other change still runs at once", async () => {
    const user = userEvent.setup();
    open({ enrolmentUntil: null });

    assert.ok(screen.queryByRole("button", { name: "Passkey hinzufügen" }) === null, "the add control skipped the narrower window");
    assert.ok(screen.getByRole("button", { name: "Mit Passkey bestätigen" }));

    await user.click(screen.getByRole("button", { name: "Abmelden" }));

    await waitFor(() => assert.deepEqual(sent(), [["endAnmeldungAction", "andere"]]));
    assert.ok(screen.queryByRole("dialog") === null, "a change inside the two hours asked for a confirmation");
  });

  /* The window closes while the page stands: the control turns back into the confirmation unpressed. */
  // Real timers and a window a fifth of a second long: mocked ones would also stop the waiting below.
  it("turns the add control back into the confirmation when the enrolment window closes", async () => {
    open({ enrolmentUntil: Date.now() + 200 });
    assert.ok(screen.getByRole("button", { name: "Passkey hinzufügen" }));

    await screen.findByRole("button", { name: "Mit Passkey bestätigen" });
  });

  it("adds on the first press inside the window", async () => {
    const user = userEvent.setup();
    const seen = open();

    await user.click(screen.getByRole("button", { name: "Passkey hinzufügen" }));

    await waitFor(() => assert.deepEqual(reached, ["addPasskey"]));
    await waitFor(() => assert.ok(seen.refresh >= 1, "the page kept its list over the enrolment"));
  });

  it("stays the confirmation, and says why, when the confirmation fails", async () => {
    const user = userEvent.setup();
    ceremony.signInPasskey = refused(400, "ERROR_CEREMONY_ABORTED");
    open({ freshUntil: null, enrolmentUntil: null });

    await user.click(screen.getByRole("button", { name: "Mit Passkey bestätigen" }));

    await waitFor(() => assert.ok(screen.getByRole("alert").textContent?.includes(STEP_UP_REFUSED)));
    assert.ok(screen.queryByRole("button", { name: "Passkey hinzufügen" }) === null);
  });

  it("closes the add control at the cap, whatever the window", () => {
    open({ kannHinzufuegen: false, freshUntil: null, enrolmentUntil: null });

    closedControl("Passkey hinzufügen", "Mehr Passkeys gehen nicht. Lösche zuerst einen.");
    assert.ok(
      screen.queryByRole("button", { name: "Mit Passkey bestätigen" }) === null,
      "a confirmation is offered for an add the cap refuses",
    );
  });

  it("names the loser of two changes at once", async () => {
    const user = userEvent.setup();
    ceremony.addPasskey = refused(409, "PASSKEY_ENROLMENT_CONFLICT");
    open();

    await user.click(screen.getByRole("button", { name: "Passkey hinzufügen" }));

    await waitFor(() =>
      assert.deepEqual(toasts(), [
        ["danger", "Passkey nicht hinzugefügt", "Gleichzeitig wurde ein anderer Passkey hinzugefügt oder gelöscht. Versuche es noch einmal."],
      ]),
    );
  });

  /* The guard answers the cap, a stale sign-in and an authenticator already held alike 404, so the page
     asks which it was (`docs/frontend/spec.md :: I427`). */
  describe("a 404 from the enrolment guard", () => {
    it("names the cap where the re-read finds it reached", async () => {
      const user = userEvent.setup();
      ceremony.addPasskey = refused(404);
      answers.readPasskeyStandAction = { success: true, kannHinzufuegen: false };
      open();

      await user.click(screen.getByRole("button", { name: "Passkey hinzufügen" }));

      await waitFor(() =>
        assert.deepEqual(toasts(), [["danger", "Passkey nicht hinzugefügt", "Mehr Passkeys gehen nicht. Lösche zuerst einen."]]),
      );
    });

    it("turns the control back into the confirmation where the re-read finds the window closed", async () => {
      const user = userEvent.setup();
      ceremony.addPasskey = refused(404);
      answers.readPasskeyStandAction = STALE;
      open();

      await user.click(screen.getByRole("button", { name: "Passkey hinzufügen" }));

      await waitFor(() => assert.deepEqual(toasts(), [["danger", "Passkey nicht hinzugefügt", STEP_UP_REQUIRED]]));
      await screen.findByRole("button", { name: "Mit Passkey bestätigen" });
    });

    it("asks for another try where neither holds: the authenticator was already held", async () => {
      const user = userEvent.setup();
      ceremony.addPasskey = refused(404);
      answers.readPasskeyStandAction = { success: true, kannHinzufuegen: true };
      open();

      await user.click(screen.getByRole("button", { name: "Passkey hinzufügen" }));

      await waitFor(() => assert.deepEqual(toasts(), [["danger", "Passkey nicht hinzugefügt", "Versuche es noch einmal."]]));
      assert.ok(screen.getByRole("button", { name: "Passkey hinzufügen" }), "a fresh session lost its add control");
    });
  });

  /* A verification that never came back may follow a stored passkey (`docs/frontend/spec.md :: I326`). */
  it("says an enrolment whose answer never came back may have landed", async () => {
    const user = userEvent.setup();
    ceremony.addPasskey = refused(502);
    open();

    await user.click(screen.getByRole("button", { name: "Passkey hinzufügen" }));

    await waitFor(() => assert.equal(raised.length, 1));
    assert.deepEqual(
      [raised[0]?.title, raised[0]?.description, raised[0]?.options?.outcome],
      ["Passkey nicht hinzugefügt", unansweredAction().error, "unknown"],
    );
  });
});
