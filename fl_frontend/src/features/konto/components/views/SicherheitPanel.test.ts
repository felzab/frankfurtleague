import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { registerDoubles } from "@/core/exportingModule.ts";
import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { VERSUCHE_ES_ERNEUT_SATZ } from "@/shared/utils/refusal.ts";

import type { Navigations } from "@/shared/testing/nextContexts.ts";
import type { Sicherheit } from "../../types.ts";

/* The browser's own credential calls, replaced at the module boundary: this runner has no
   `navigator.credentials`, and a test-only prop would be a seam in production code. */
const CLIENT_DOUBLE = {
  authClient: { passkey: { addPasskey: () => run("addPasskey") }, signIn: { passkey: () => run("signInPasskey") } },
};

registerDoubles({
  modules: {
    "core/authClient.ts": CLIENT_DOUBLE,
  },
});

/** Which ceremony the page reached for, in order. */
const reached: string[] = [];

/** What each ceremony answers, by name. Better Auth reports a failed ceremony on `error`, never by throwing. */
const ceremony: Record<string, () => Promise<unknown>> = {};

const SUCCEEDED = () => Promise.resolve({ data: {}, error: null });

function run(name: string): Promise<unknown> {
  reached.push(name);
  return (ceremony[name] ?? SUCCEEDED)();
}

/** Each action's answer, by name; one not named answers a plain success. */
const answers: Record<string, unknown> = {};

const {
  calls,
  answerWith,
  answered: actionsAnswered,
} = doubleActions({
  modules: [/\/features\/passkeys\/actions\.ts$/, /\/features\/konto\/actions\.ts$/, /\/features\/auth\/actions\.ts$/],
});
const { raised } = doubleToasts();
const fetchMock = doubleFetch();

const { SicherheitPanel } = await import("./SicherheitPanel.tsx");
const { outcomeUnknown } = await import("@/shared/utils/actionError.ts");
const { LETZTER_PASSKEY } = await import("@/features/passkeys/components/ui/PasskeyKarteView.tsx");
const { refusalWrappers } = await import("@/shared/testing/renderTest.ts");

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const STEP_UP_REQUIRED = "Bestätige zuerst, dass Du es bist.";
const STEP_UP_REFUSED = "Wir konnten Dich nicht mit einem Passkey bestätigen.";
const CODE_STEP_UP_REFUSED = "Wir konnten Dich nicht mit dem Code bestätigen.";

/** The other device's sign-out and the card's two controls, as a screen reader names them. */
const ANDERE_ABMELDEN = "Abmelden: Anmeldung per Passkey „Laptop“ vom 25. September 2026, 10:00";
const LAPTOP_LOESCHEN = "Löschen: Passkey „Laptop“";
const LAPTOP_UMBENENNEN = "Umbenennen: Passkey „Laptop“";

/** The holder's own address, where the code half mails its code. */
const ADDRESS = "spielerin@example.org";

/** The send's answer, as the sign-in's own action gives it. */
const SENT = { success: true, message: "Ein Anmeldecode ist an Deine Adresse unterwegs." };

/** The code route's answer to one typed code, as `postPublicForm` reads it. */
const answered = (body: unknown): Response =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** Sends the code from the control in `scope` and types it; the route answers that it signed in. */
async function confirmByCode(user: ReturnType<typeof userEvent.setup>, scope: { getByRole: typeof screen.getByRole }): Promise<void> {
  answers.sendeBestaetigungscodeAction = SENT;
  await user.click(scope.getByRole("button", { name: "Code per E-Mail senden" }));
  await act(actionsAnswered);
  const field = await screen.findByLabelText<HTMLInputElement>("Code aus der E-Mail");
  fetchMock.mock.mockImplementationOnce(() => Promise.resolve(answered({ success: true })));
  await user.type(field, "048213");
  // The code's route answers first, and the holder check and the change it waited for after it.
  await act(fetchMock.answered);
  await act(actionsAnswered);
}

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
  inhaberAdresse: ADDRESS,
  freshUntil: Date.now() + HOUR_MS,
  enrolmentUntil: Date.now() + 4 * MINUTE_MS,
  // The server's clock and the browser's agree unless a case says otherwise.
  servedAt: Date.now(),
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

    await user.click(screen.getByRole("button", { name: ANDERE_ABMELDEN }));
    assert.deepEqual(sent(), [], "a change was sent before the confirmation");

    await user.click((await dialog()).getByRole("button", { name: "Mit Passkey bestätigen" }));
    await act(actionsAnswered);

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

  /* Once the page's session has ended, the challenge names nobody and another account's passkey signs
     that account in; the waiting change would run as it (`docs/frontend/spec.md :: I428`). */
  it("runs nothing when the confirmation signed another account in, and says so", async () => {
    const user = userEvent.setup();
    answers.pruefeInhaberAction = { success: true, gleich: false };
    open({ freshUntil: null, enrolmentUntil: null });

    await user.click(screen.getByRole("button", { name: ANDERE_ABMELDEN }));
    await user.click((await dialog()).getByRole("button", { name: "Mit Passkey bestätigen" }));
    await act(actionsAnswered);

    const panel = await dialog();
    await waitFor(() => assert.ok(panel.getByRole("alert").textContent?.includes(STEP_UP_REFUSED)));
    assert.deepEqual(sent(), [["pruefeInhaberAction", "inhaber"]]);
  });

  it("says a failed confirmation and runs nothing", async () => {
    const user = userEvent.setup();
    ceremony.signInPasskey = refused(400, "ERROR_CEREMONY_ABORTED");
    open({ freshUntil: null, enrolmentUntil: null });

    await user.click(screen.getByRole("button", { name: ANDERE_ABMELDEN }));
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

    await user.click(screen.getByRole("button", { name: ANDERE_ABMELDEN }));
    await act(actionsAnswered);

    assert.ok((await dialog()).getByRole("button", { name: "Mit Passkey bestätigen" }));
    assert.deepEqual(toasts(), []);
  });

  /* A rename that waited for a confirmation lands after its form's own promise settled: the form
     closes on the landing, not on the press. */
  it("closes the rename form once a rename it waited for lands", async () => {
    const user = userEvent.setup();
    answers.pruefeInhaberAction = { success: true, gleich: true };
    open({ freshUntil: null, enrolmentUntil: null });

    await user.click(screen.getByRole("button", { name: LAPTOP_UMBENENNEN }));
    await user.clear(screen.getByRole("textbox", { name: "Name" }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), "Mein iPhone");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await user.click((await dialog()).getByRole("button", { name: "Mit Passkey bestätigen" }));
    await act(actionsAnswered);

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

    await user.click(screen.getByRole("button", { name: LAPTOP_UMBENENNEN }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), " Pro");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(actionsAnswered);

    await waitFor(() => assert.equal(toasts().at(-1)?.[1], "Passkey nicht umbenannt"));
    assert.ok(screen.getByRole("textbox", { name: "Name" }), "a refused rename closed the form");
  });
});

describe("where renaming a passkey leaves the focus", () => {
  /* The rename swaps the card's controls for a form and back, each from under the press that asked;
     booleans rather than nodes, since a failing report inspects a jsdom node's whole window. */
  it("hands the name field the focus when the form opens, and the rename control when it is cancelled", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: LAPTOP_UMBENENNEN }));
    const imFeld = document.activeElement === screen.getByRole("textbox", { name: "Name" });
    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    const zurueck = document.activeElement === screen.getByRole("button", { name: LAPTOP_UMBENENNEN });

    assert.ok(imFeld, "the form replaced the pressed control and the focus fell to the page");
    assert.ok(zurueck, "the cancelled form unmounted under the caret and the focus fell to the page");
  });

  it("moves no focus when the card first renders", () => {
    open();

    assert.ok(document.activeElement === document.body, "the card took the focus on load, with no rename ever opened");
  });

  it("hands the rename control the focus once a stored name closes the form", async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole("button", { name: LAPTOP_UMBENENNEN }));
    await user.type(screen.getByRole("textbox", { name: "Name" }), " Pro");
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(actionsAnswered);
    await waitFor(() => assert.ok(screen.queryByRole("textbox", { name: "Name" }) === null));

    assert.ok(document.activeElement === screen.getByRole("button", { name: /^Umbenennen: / }), "the saved form left the focus on the page");
  });
});

describe("removing a passkey", () => {
  /* The removal ended the session this page ran in, so the page itself has nothing left to show. */
  it("leaves for the sign-in page once the passkey this device signed in with is gone", async (t) => {
    const user = userEvent.setup();
    answers.removePasskeyAction = { success: true, message: "Passkey gelöscht", diesesGeraet: true };
    const seen = open();
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });

    await user.click(screen.getByRole("button", { name: LAPTOP_LOESCHEN }));
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: "Ja, Passkey löschen" }));
    await act(actionsAnswered);

    await waitFor(() => assert.deepEqual(seen.replaced, ["/signin"]));
    assert.deepEqual(sent(), [["removePasskeyAction", "eins"]]);
  });

  it("stays on the page after removing a passkey another device signed in with", async (t) => {
    const user = userEvent.setup();
    answers.removePasskeyAction = { success: true, message: "Passkey gelöscht", diesesGeraet: false };
    const seen = open();
    t.mock.timers.enable({ apis: ["Date"], now: Date.now() });

    await user.click(screen.getByRole("button", { name: LAPTOP_LOESCHEN }));
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: "Ja, Passkey löschen" }));
    await act(actionsAnswered);

    await waitFor(() => assert.equal(toasts().at(-1)?.[1], "Passkey gelöscht"));
    assert.deepEqual(seen.replaced, []);
  });

  /* Closed, the overlay is the deletion's one tab stop, so it carries the passkey's name as the open control
     does; speech input still finds it by „Löschen“, whatever the case. */
  it("closes an administrator's last passkey's deletion under the passkey's name", () => {
    open({ verwaltung: true });

    assert.deepEqual(refusalWrappers(document.body.innerHTML), [{ name: LAPTOP_LOESCHEN, label: LAPTOP_LOESCHEN, reason: LETZTER_PASSKEY }]);
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
    await act(actionsAnswered);

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

    await user.click(screen.getByRole("button", { name: ANDERE_ABMELDEN }));
    await act(actionsAnswered);

    await waitFor(() => assert.deepEqual(sent(), [["endAnmeldungAction", "andere"]]));
    assert.ok(screen.queryByRole("dialog") === null, "a change inside the two hours asked for a confirmation");
    // Its answer lands inside the case, so none is left pending into the next.
    await waitFor(() => assert.equal(raised.length, 1));
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

  /* The guard answers the cap, a stale sign-in and an authenticator already held alike 404, so the page
     asks which it was (`docs/frontend/spec.md :: I427`). */
  describe("a 404 from the enrolment guard", () => {
    it("names the cap where the re-read finds it reached", async () => {
      const user = userEvent.setup();
      ceremony.addPasskey = refused(404);
      answers.readPasskeyStandAction = { success: true, kannHinzufuegen: false };
      open();

      await user.click(screen.getByRole("button", { name: "Passkey hinzufügen" }));
      await act(actionsAnswered);

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
      await act(actionsAnswered);

      await waitFor(() => assert.deepEqual(toasts(), [["danger", "Passkey nicht hinzugefügt", STEP_UP_REQUIRED]]));
      await screen.findByRole("button", { name: "Mit Passkey bestätigen" });
    });

    it("asks for another try where neither holds: the authenticator was already held", async () => {
      const user = userEvent.setup();
      ceremony.addPasskey = refused(404);
      answers.readPasskeyStandAction = { success: true, kannHinzufuegen: true };
      open();

      await user.click(screen.getByRole("button", { name: "Passkey hinzufügen" }));
      await act(actionsAnswered);

      await waitFor(() => assert.deepEqual(toasts(), [["danger", "Passkey nicht hinzugefügt", VERSUCHE_ES_ERNEUT_SATZ]]));
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
      ["Unklar, ob es gespeichert wurde", outcomeUnknown().error, "unknown"],
    );
  });
});

/* The code is a person's other way to a fresh sign-in, and the only one while they hold no passkey:
   nobody is stuck behind the panel for want of an authenticator. */
describe("confirming by a code mailed to the holder", () => {
  it("sends the code to the holder's own address, then runs the change it waited for", async () => {
    const user = userEvent.setup();
    answers.pruefeInhaberAction = { success: true, gleich: true };
    const seen = open({ freshUntil: null, enrolmentUntil: null });

    await user.click(screen.getByRole("button", { name: ANDERE_ABMELDEN }));
    await confirmByCode(user, await dialog());

    await waitFor(() => assert.deepEqual(sent().at(-1), ["endAnmeldungAction", "andere"]));
    assert.deepEqual(
      sent().map(([action]) => action),
      ["sendeBestaetigungscodeAction", "pruefeInhaberAction", "endAnmeldungAction"],
    );
    const [, init] = fetchMock.mock.calls[0]?.arguments ?? [];
    assert.deepEqual(JSON.parse(String(init?.body)), { email: ADDRESS, code: "048213" });
    assert.deepEqual(reached, [], "the code path ran a passkey ceremony");
    assert.ok(seen.refresh >= 1, "the page kept what it drew off the session the code ended");
    await waitFor(() => assert.equal(raised.length, 1, "the change the code waited for never answered"));
  });

  /* The holder check holds on this path too (`docs/frontend/spec.md :: I428`): a code whose sign-in is
     another account's runs nothing, and the step is closed rather than left pending. */
  it("runs nothing when the code signed another account in, and says so", async () => {
    const user = userEvent.setup();
    answers.pruefeInhaberAction = { success: true, gleich: false };
    open({ freshUntil: null, enrolmentUntil: null });

    await user.click(screen.getByRole("button", { name: ANDERE_ABMELDEN }));
    await confirmByCode(user, await dialog());

    const panel = await dialog();
    await waitFor(() => assert.ok(panel.getByRole("alert").textContent?.includes(CODE_STEP_UP_REFUSED)));
    assert.deepEqual(
      sent().map(([action]) => action),
      ["sendeBestaetigungscodeAction", "pruefeInhaberAction"],
    );
    assert.ok(panel.getByRole("button", { name: "Code per E-Mail senden" }), "the refused step left no way to try again");
  });

  /* The route answers a spent code with `bereits` where another tab's session for the address stands:
     that code confirmed nothing, so the waiting change never runs on it. */
  it("runs nothing when the route answers that another tab already signed in", async () => {
    const user = userEvent.setup();
    answers.pruefeInhaberAction = { success: true, gleich: true };
    answers.sendeBestaetigungscodeAction = SENT;
    open({ freshUntil: null, enrolmentUntil: null });

    await user.click(screen.getByRole("button", { name: ANDERE_ABMELDEN }));
    const panel = await dialog();
    await user.click(panel.getByRole("button", { name: "Code per E-Mail senden" }));
    await act(actionsAnswered);
    const field = await screen.findByLabelText<HTMLInputElement>("Code aus der E-Mail");
    fetchMock.mock.mockImplementationOnce(() => Promise.resolve(answered({ success: true, bereits: true })));
    await user.type(field, "048213");
    await act(fetchMock.answered);

    await waitFor(() => assert.ok(panel.getByRole("alert").textContent?.includes(CODE_STEP_UP_REFUSED)));
    assert.deepEqual(
      sent().map(([action]) => action),
      ["sendeBestaetigungscodeAction"],
    );
  });

  /* Holding no passkey, the panel offers no prompt the person cannot answer. */
  it("offers a person holding no passkey the code alone", async () => {
    const user = userEvent.setup();
    open({ passkeys: [], freshUntil: null, enrolmentUntil: null });

    await user.click(screen.getByRole("button", { name: ANDERE_ABMELDEN }));

    const panel = await dialog();
    assert.ok(panel.getByRole("button", { name: "Code per E-Mail senden" }));
    assert.ok(panel.queryByRole("button", { name: "Mit Passkey bestätigen" }) === null, "a person with no passkey is asked for one");
  });

  it("confirms a person holding no passkey by code, and the same control then sets one up", async () => {
    const user = userEvent.setup();
    answers.pruefeInhaberAction = { success: true, gleich: true };
    open({ passkeys: [], freshUntil: null, enrolmentUntil: null });

    assert.ok(screen.queryByRole("button", { name: "Mit Passkey bestätigen" }) === null);
    await confirmByCode(user, screen);

    await user.click(await screen.findByRole("button", { name: "Passkey einrichten" }));
    await waitFor(() => assert.deepEqual(reached, ["addPasskey"]));
  });

  /* The confirmed code step leaves the page with the field the reader typed in. */
  it("hands the focus to the add control the code's confirmation opens", async () => {
    const user = userEvent.setup();
    answers.pruefeInhaberAction = { success: true, gleich: true };
    open({ passkeys: [], freshUntil: null, enrolmentUntil: null });

    await confirmByCode(user, screen);

    const einrichten = await screen.findByRole("button", { name: "Passkey einrichten" });
    await waitFor(() => assert.ok(document.activeElement === einrichten, "the confirmation left the focus off the control it opened"));
  });

  /* An administrator's confirmation is the passkey's alone (`docs/frontend/spec.md :: I422`). */
  it("offers an administrator no code", async () => {
    const user = userEvent.setup();
    open({ verwaltung: true, freshUntil: null, enrolmentUntil: null });

    await user.click(screen.getByRole("button", { name: ANDERE_ABMELDEN }));

    const panel = await dialog();
    assert.ok(panel.getByRole("button", { name: "Mit Passkey bestätigen" }));
    assert.ok(panel.queryByRole("button", { name: "Code per E-Mail senden" }) === null, "an administrator is offered a code");
    assert.ok(screen.queryAllByRole("button", { name: "Code per E-Mail senden" }).length === 0);
  });
});

/* The administrator's shell keeps its windows by the same rules (`docs/frontend/spec.md :: I494`): a
   render bringing the server's figures replaces the page's own, which the confirmation's refresh is. */
describe("the page's windows against the server's render", () => {
  /** The panel as one server render hands it over, and a later render with a new object. */
  function served(fields: Partial<Sicherheit>): { again: (next: Partial<Sicherheit>) => void } {
    const { router } = recordingRouter();
    const { rerender } = render(underNext(h(SicherheitPanel, { sicherheit: sicherheit(fields) }), { router }));
    return { again: (next) => rerender(underNext(h(SicherheitPanel, { sicherheit: sicherheit(next) }), { router })) };
  }

  /* Another tab's sign-in, or the refresh after this page's own confirmation, opens the window server-side:
     keyed on the first render alone, the page would ask again for a confirmation the session holds. */
  it("offers the enrolment once a render brings a window the page did not open", async () => {
    const { again } = served({ freshUntil: null, enrolmentUntil: null });
    assert.ok(screen.getByRole("button", { name: "Mit Passkey bestätigen" }));

    again({});

    assert.ok(await screen.findByRole("button", { name: "Passkey hinzufügen" }), "the server's open window left the page asking");
  });

  it("drops a confirmation of its own at the next render even where the figures are unchanged", async () => {
    const user = userEvent.setup();
    answers.pruefeInhaberAction = { success: true, gleich: true };
    const { again } = served({ freshUntil: null, enrolmentUntil: null });

    await user.click(screen.getByRole("button", { name: "Mit Passkey bestätigen" }));
    await act(actionsAnswered);
    await screen.findByRole("button", { name: "Passkey hinzufügen" });

    again({ freshUntil: null, enrolmentUntil: null });

    assert.ok(
      await screen.findByRole("button", { name: "Mit Passkey bestätigen" }),
      "a confirmation the server's render did not carry outlived it",
    );
  });

  /* The figures are the server's clock and the lapse timer the browser's: a browser minutes fast met the
     five minutes already spent, closing the add control as each confirmation's refresh drew it. */
  it("keeps the time a render left on a browser clock minutes fast", async () => {
    const serverNow = Date.now() - 6 * MINUTE_MS;
    const { again } = served({ freshUntil: null, enrolmentUntil: null, servedAt: serverNow });

    again({ freshUntil: serverNow + HOUR_MS, enrolmentUntil: serverNow + 4 * MINUTE_MS, servedAt: serverNow });
    assert.ok(screen.getByRole("button", { name: "Passkey hinzufügen" }));

    // Past the lapse timer's first turn, which a window read across the two clocks takes at once.
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(screen.queryByRole("button", { name: "Passkey hinzufügen" }), "the add control closed on a window the server held open");
  });

  // Real timers and a window a fifth of a second long, as the lapse case above has them.
  it("closes the window when the render said on a browser clock minutes slow", async () => {
    const serverNow = Date.now() + 6 * MINUTE_MS;
    open({ enrolmentUntil: serverNow + 200, servedAt: serverNow });
    assert.ok(screen.getByRole("button", { name: "Passkey hinzufügen" }));

    await screen.findByRole("button", { name: "Mit Passkey bestätigen" });
  });

  /* The enrolment's window sits inside the step-up's: a refusal closing the wider one leaves no add
     control standing on the narrower one, which the enrolment guard would refuse in turn. */
  it("closes the enrolment's window with the step-up's on the server's refusal", async () => {
    const user = userEvent.setup();
    answers.endAnmeldungAction = STALE;
    open();
    assert.ok(screen.getByRole("button", { name: "Passkey hinzufügen" }));

    await user.click(screen.getByRole("button", { name: ANDERE_ABMELDEN }));
    await act(actionsAnswered);
    await dialog();

    assert.ok(
      screen.queryByRole("button", { name: "Passkey hinzufügen", hidden: true }) === null,
      "the add control outlived the window around it",
    );
  });
});
