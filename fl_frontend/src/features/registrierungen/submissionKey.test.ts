import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";

import { createElement as h } from "react";

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";

import type { FLEinladungAnsichtResponse } from "./schemas.ts";

/** The write, answered by the case that sends one; unset, a request never returns. */
const fetchMock = mock.fn<(input?: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() => new Promise<never>(() => undefined));

// The browser's own `fetch`, so the key is read off the request the panel actually makes.
globalThis.fetch = ((input, init) => fetchMock(input, init)) as typeof fetch;

const { raised } = doubleToasts();

const { RegistrierungFormPanel } = await import("./components/views/RegistrierungFormPanel.tsx");

const ANSICHT: FLEinladungAnsichtResponse = {
  acknowledged: 1,
  team: "Lessing-Kolleg",
  schule: "Lessing-Kolleg Oberstufengymnasium",
  saison_id: "2026",
  saison_status: "future",
  laeuft: true,
  erlaubte_stufen: ["Q1", "Q2"],
  kader_frei: true,
  team_eingetragen: true,
  nachnominierung: false,
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** What every arm that may have landed tells the pupil, spelled here so a rewording fails a case. */
const REGISTRIERUNG_UNKLAR = "Schick die Registrierung hier unverändert noch einmal ab: Doppelt ankommen kann sie so nicht.";

const UNKLAR = JSON.stringify({ success: false, error: "Ob die Änderung gespeichert wurde, ist unklar.", outcome: "unknown" });

/** The key each request to the registration route carried, in the order the presses were made. */
const keysSent = (): (string | null)[] =>
  fetchMock.mock.calls
    .filter(({ arguments: [input] }) => String(input) === "/api/registrierung")
    .map(({ arguments: [, init] }) => new Headers(init?.headers).get("Idempotency-Key"));

const failureToasts = () =>
  raised.filter((toast) => toast.variant === "danger").map((toast) => [toast.title, toast.description] as [string, string | undefined]);

/** One mounted panel, filled in as a pupil fills it, and pressed. */
async function registerOnce(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByRole("textbox", { name: /Vorname/ }), "Mira");
  await user.type(screen.getByRole("textbox", { name: /Nachname/ }), "Kern");
  await user.type(screen.getByRole("textbox", { name: /E-Mail/ }), "mira.kern@beispiel.test");
  await user.click(screen.getByRole("button", { name: /Registrierung abschicken/ }));
}

beforeEach(() => {
  fetchMock.mock.resetCalls();
  raised.length = 0;
  cleanup();
});

describe("the registration's submission key", () => {
  /* `docs/frontend/spec.md :: I348`: the second press carries the first one's key, so the
     backend answers it as the first rather than storing a second registration. */
  it("keeps one key while the outcome is unknown", async () => {
    const user = userEvent.setup();
    fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(UNKLAR, { status: 200 })));
    render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, onLinkTot: () => undefined }));

    await registerOnce(user);
    await user.click(await screen.findByRole("button", { name: /Registrierung abschicken/ }, { timeout: 5000 }));
    await screen.findByRole("button", { name: /Registrierung abschicken/ }, { timeout: 5000 });

    const keys = keysSent();
    assert.equal(keys.length, 2, "the panel did not send both presses");
    assert.match(keys[0] ?? "", UUID_V4, "the key is not the version-4 UUID the backend takes");
    assert.equal(keys[1], keys[0], "the second press carried a key of its own, so it would store a second registration");
  });

  /* The row whose mail the provider refused IS stored under the first key, so the press after the
     corrected address must be a new registration: under that key it would be refused as another request's. */
  it("takes a fresh key after the refused mail's answer", async () => {
    const user = userEvent.setup();
    fetchMock.mock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ success: false, fieldErrors: { email: "abgewiesen" } }), { status: 200 })),
    );
    render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, onLinkTot: () => undefined }));

    await registerOnce(user);
    await user.click(await screen.findByRole("button", { name: /Registrierung abschicken/ }, { timeout: 5000 }));
    await screen.findByRole("button", { name: /Registrierung abschicken/ }, { timeout: 5000 });

    const keys = keysSent();
    assert.equal(keys.length, 2, "the panel did not send both presses");
    assert.notEqual(keys[1], keys[0], "the press after the corrected address replayed the stored row's request");
  });

  /* A sentence alone is either an answer that judged nothing, whose write may stand, or the refusal
     saying the first details stand: a fresh key would store a second registration behind either. */
  for (const [answer, body] of [
    ["the refusal saying the first details stand", { success: false, error: "Deine Registrierung ist schon angekommen." }],
    ["an answer that judged nothing", { success: false, error: "Der Server hat mit einem Fehler geantwortet. Versuche es erneut." }],
  ] as const) {
    it(`keeps its key after ${answer}`, async () => {
      const user = userEvent.setup();
      fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));
      render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, onLinkTot: () => undefined }));

      await registerOnce(user);
      await user.click(await screen.findByRole("button", { name: /Registrierung abschicken/ }, { timeout: 5000 }));
      await screen.findByRole("button", { name: /Registrierung abschicken/ }, { timeout: 5000 });

      const keys = keysSent();
      assert.equal(keys.length, 2, "the panel did not send both presses");
      assert.equal(keys[1], keys[0], "the second press carried a key of its own, so it would store a second registration");
    });
  }

  /* The request may have reached the route before the connection broke: a fresh key would store a
     second registration behind the first. */
  it("keeps its key after an unread answer", async () => {
    const user = userEvent.setup();
    fetchMock.mock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, onLinkTot: () => undefined }));

    await registerOnce(user);
    await user.click(await screen.findByRole("button", { name: /Registrierung abschicken/ }, { timeout: 5000 }));
    await screen.findByRole("button", { name: /Registrierung abschicken/ }, { timeout: 5000 });

    const keys = keysSent();
    assert.equal(keys.length, 2, "the panel did not send both presses");
    assert.equal(keys[1], keys[0], "the second press carried a key of its own, so it would store a second registration");
  });

  it("gives every mount a key of its own", async () => {
    fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200 })));

    for (let mount = 0; mount < 2; mount += 1) {
      const user = userEvent.setup();
      render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, onLinkTot: () => undefined }));
      await registerOnce(user);
      await screen.findByRole("status");
      cleanup();
    }

    const keys = keysSent();
    assert.equal(keys.length, 2);
    assert.notEqual(keys[0], keys[1], "two registrations share a key, so the second would be answered as the first");
  });

  /* The request may have reached the route before the connection broke: one next step for every arm
     that may have landed, never a bare retry beside the unknown outcome's replay. */
  it("gives an unread answer the unknown outcome's one step", async () => {
    const user = userEvent.setup();
    fetchMock.mock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    render(h(RegistrierungFormPanel, { token: "kein-echtes-token", ansicht: ANSICHT, onLinkTot: () => undefined }));

    await registerOnce(user);
    await screen.findByRole("button", { name: /Registrierung abschicken/ }, { timeout: 5000 });

    assert.deepEqual(failureToasts(), [["Unklar, ob es bei uns angekommen ist", REGISTRIERUNG_UNKLAR]]);
  });
});
