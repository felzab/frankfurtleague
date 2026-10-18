import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { GrantHolderStepUp, LoeschungStart } from "./LoeschungView.tsx";

/* The browser's own credential call, replaced at the module boundary: this runner has no
   `navigator.credentials`, and a test-only prop would be a seam in production code. */
registerDoubles({ modules: { "core/authClient.ts": { authClient: { signIn: { passkey: () => ceremony() } } } } });

/** What the assertion answers, counting each one. Better Auth reports a failed ceremony on `error`, never by throwing. */
let ceremonies = 0;
let ceremonyAnswer: () => Promise<unknown> = () => Promise.resolve({ data: {}, error: null });
const ceremony = (): Promise<unknown> => ((ceremonies += 1), ceremonyAnswer());

const { calls, answerWith, answered } = doubleActions({
  modules: [/\/features\/konto\/actions\.ts$/, /\/features\/konto\/personActions\.ts$/],
});
doubleToasts();

const { LoeschungView } = await import("./LoeschungView.tsx");

const TOKEN = "kein-echtes-token";

const BEREIT: LoeschungStart = {
  zustand: "bereit",
  token: TOKEN,
  email: "vorstand@example.org",
  ansicht: {
    spieler: [],
    schiedsrichter: [],
    sitze: [],
    bewerbungen: [],
    registrierungen: [],
    adresswechsel: 0,
    verwaltung: "owner",
    letzter_inhaber: false,
  },
};

const MINUTE_MS = 60 * 1000;

/** A grant holder's figures as the page serves them: inside the enrolment's window, or past every window. */
const verwaltend = (offen: boolean): GrantHolderStepUp => ({
  freshUntil: offen ? Date.now() + 60 * MINUTE_MS : null,
  enrolmentUntil: offen ? Date.now() + 4 * MINUTE_MS : null,
  servedAt: Date.now(),
  holderId: "inhaberin",
});

/** Each action's answer, by name; the deletion answers its success unless a case says otherwise. */
const answers: Record<string, unknown> = {};

const sent = () => calls.map((call) => [call.action, call.payload]);

/** Whether the prompt's refusal stands beside the press: the armed press's own warning is an alert too. */
const promptRefused = (): boolean =>
  screen.getAllByRole("alert").some((alert) => alert.textContent.includes("Wir konnten Dich nicht mit einem Passkey bestätigen."));

beforeEach(() => {
  ceremonies = 0;
  ceremonyAnswer = () => Promise.resolve({ data: {}, error: null });
  calls.length = 0;
  for (const name of Object.keys(answers)) Reflect.deleteProperty(answers, name);
  answerWith(() =>
    Promise.resolve(answers[calls.at(-1)?.action ?? ""] ?? { success: true, message: "Dein Konto und Deine Angaben sind gelöscht." }),
  );
});

/* As the administrator's shell asks before a revoke: the armed press runs the prompt, then sends
   (`docs/frontend/spec.md :: I707`, `:: I431`). */
describe("a grant holder's press on the deletion link's interstitial", () => {
  it("asks past the window for the passkey, then sends the deletion with the link", async () => {
    answers.pruefeInhaberAction = { success: true, gleich: true };
    render(underNext(h(LoeschungView, { start: BEREIT, stepUp: verwaltend(false) })));

    await pressTwice(userEvent.setup(), { resting: "Konto endgültig löschen", armed: "Mit Passkey bestätigen" });
    await act(answered);

    await waitFor(() =>
      assert.deepEqual(sent(), [
        ["pruefeInhaberAction", "inhaberin"],
        ["loescheKontoAction", TOKEN],
      ]),
    );
    assert.equal(ceremonies, 1);
  });

  /* Once the page's session has ended, the challenge names nobody and another account's passkey signs that
     account in (`docs/frontend/spec.md :: I428`). */
  it("sends nothing when the confirmation signed another account in", async () => {
    answers.pruefeInhaberAction = { success: true, gleich: false };
    render(underNext(h(LoeschungView, { start: BEREIT, stepUp: verwaltend(false) })));

    await pressTwice(userEvent.setup(), { resting: "Konto endgültig löschen", armed: "Mit Passkey bestätigen" });
    await act(answered);

    await waitFor(() => assert.ok(promptRefused(), "the press says nothing of the refused confirmation"));
    assert.deepEqual(sent(), [["pruefeInhaberAction", "inhaberin"]]);
  });

  it("sends nothing when the prompt was refused", async () => {
    ceremonyAnswer = () =>
      Promise.resolve({ data: null, error: { status: 400, statusText: "x", message: "x", code: "ERROR_CEREMONY_ABORTED" } });
    render(underNext(h(LoeschungView, { start: BEREIT, stepUp: verwaltend(false) })));

    await pressTwice(userEvent.setup(), { resting: "Konto endgültig löschen", armed: "Mit Passkey bestätigen" });

    await waitFor(() => assert.ok(promptRefused(), "the press says nothing of the refused prompt"));
    assert.deepEqual(sent(), []);
  });

  for (const [label, stepUp] of [
    ["a grant holder inside the window", verwaltend(true)],
    ["a person holding no grant", null],
  ] as const) {
    it(`arms ${label} on the deletion's own words and sends it without a prompt`, async () => {
      render(underNext(h(LoeschungView, { start: BEREIT, stepUp: stepUp })));

      await pressTwice(userEvent.setup(), { resting: "Konto endgültig löschen", armed: "Ja, Konto endgültig löschen" });
      await act(answered);

      await waitFor(() => assert.deepEqual(sent(), [["loescheKontoAction", TOKEN]]));
      assert.equal(ceremonies, 0);
    });
  }
});
