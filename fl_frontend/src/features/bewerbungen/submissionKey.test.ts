import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";

import { act, createElement as h } from "react";

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";

import type { BewerbungFormDraft } from "./types.ts";

type User = ReturnType<typeof userEvent.setup>;

/*
 A file of its own rather than cases in `fl_frontend/src/features/bewerbungen/form.test.ts`: that suite
 leaves a request that never returns, and an async transition still pending holds every later form's
 `isPending`, so a second press never finds its button again.
*/
const fetchMock = mock.fn<(url: string, init?: RequestInit) => Promise<Response>>();

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => fetchMock(String(input), init)) as typeof fetch;

const { raised } = doubleToasts();

beforeEach(() => {
  fetchMock.mock.resetCalls();
  fetchMock.mock.restore();
  raised.length = 0;
});

const { BewerbungForm } = await import("./components/forms/BewerbungForm/BewerbungForm.tsx");
const { BEWERBUNG_SEATS } = await import("./constants.ts");
const { buildEmptyBewerbungDraft } = await import("./utils.ts");
const { TRIKOT_FARBE_OPTIONS } = await import("@/features/teams/constants.ts");

const SCHOOLS = [{ id: "68d0f2a4c1e2b3a4d5e6f708", name: "Lessing-Kolleg" }];

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const person = (vorname: string, email: string, telefon: string) => ({
  vorname: vorname,
  nachname: "Muster",
  email: email,
  telefon: telefon,
  einwilligung: { ...buildEmptyBewerbungDraft("2026").kontakte.trainer.einwilligung, erteilt: true },
});

/** An application the payload schema takes whole, for a school the league already holds. */
const COMPLETE_DRAFT: BewerbungFormDraft = {
  ...buildEmptyBewerbungDraft("2026"),
  auswahl: SCHOOLS[0]!.id,
  stufengroesse: 90,
  kontakte: {
    ansprechperson: person("Anna", "anna@schule.example", "069 1111111"),
    stellvertretung: person("Bernd", "bernd@schule.example", "069 2222222"),
    trainer: person("Clara", "clara@schule.example", "069 3333333"),
    trainer_ist_zugleich: null,
  },
  trikot: { vorhandener_satz: "", wunschfarbe: TRIKOT_FARBE_OPTIONS[0]!.value },
  kader: { voraussichtliche_groesse: 14, gute_spieler: 3 },
};

const control = (container: HTMLElement, name: string): HTMLElement =>
  container.querySelector<HTMLElement>(`[name="${name}"]`) ?? assert.fail(`the form renders no control named ${name}`);

async function typeInto(user: User, box: HTMLElement, value: string): Promise<void> {
  await user.clear(box);
  await user.paste(value);
}

/** Every control the draft answers, through the control a reader would use for it. */
async function fillIn(user: User, container: HTMLElement, draft: BewerbungFormDraft): Promise<void> {
  await user.selectOptions(control(container, "team_id"), draft.auswahl ?? "");
  await typeInto(user, screen.getByRole("textbox", { name: "Größe der Stufe" }), String(draft.stufengroesse));

  for (const { value } of BEWERBUNG_SEATS) {
    for (const field of ["vorname", "nachname", "email", "telefon"] as const) {
      await typeInto(user, control(container, `kontakte.${value}.${field}`), draft.kontakte[value][field]);
    }
  }

  await user.click(screen.getByRole("switch").closest("label") ?? assert.fail("the switch renders no label to press"));
  await user.selectOptions(control(container, "trikot.wunschfarbe"), draft.trikot.wunschfarbe ?? "");
  await typeInto(user, screen.getByRole("textbox", { name: "Voraussichtliche Kadergröße" }), String(draft.kader.voraussichtliche_groesse));
  await typeInto(user, screen.getByRole("textbox", { name: "Davon im Verein aktiv (mind. Verbandsliga)" }), String(draft.kader.gute_spieler));
}

/** The form, filled in whole and pressed once. */
async function pressFilledIn(): Promise<User> {
  const user = userEvent.setup({ delay: null });
  const { container } = render(h(BewerbungForm, { saisonId: "2026", schulen: SCHOOLS, isSchulenLesbar: true, vergebeneFarben: [] }));

  await fillIn(user, container, COMPLETE_DRAFT);
  await user.click(screen.getByRole("button", { name: "Bewerbung abschicken" }));

  return user;
}

/** A request's answer arriving, and everything it sets off. */
const settle = (): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

/** The key each request to the submission route carried, in the order the presses were made. */
const keysSent = (): (string | null)[] =>
  fetchMock.mock.calls
    .filter(({ arguments: [url] }) => url === "/api/bewerbung")
    .map(({ arguments: [, init] }) => new Headers(init?.headers).get("Idempotency-Key"));

const answering = (body: unknown) => fetchMock.mock.mockImplementation(() => Promise.resolve(new Response(JSON.stringify(body))));

describe("the application's submission key", () => {
  /* `docs/frontend/spec.md :: I348`: the second press carries the first one's key, so the
     backend answers it as the first rather than storing a second application. */
  it("keeps one key while the outcome is unknown", async () => {
    answering({ success: false, error: "unklar", outcome: "unknown" });

    const user = await pressFilledIn();
    await settle();
    await user.click(await screen.findByRole("button", { name: "Bewerbung abschicken" }));
    await settle();

    const keys = keysSent();
    assert.equal(keys.length, 2, "the form did not send both presses");
    assert.match(keys[0] ?? "", UUID_V4, "the key is not the version-4 UUID the backend takes");
    assert.equal(keys[1], keys[0], "the second press carried a key of its own, so it would store a second application");
  });

  /* A refusal a box carries settles the first request, so the press after the applicant's repair is
     a new one: under the first key its changed details would be refused as another request's. */
  it("takes a fresh key after a refusal a box carries", async () => {
    answering({ success: false, fieldErrors: { team_id: "Diese Schule spielt in dieser Saison schon mit." } });

    const user = await pressFilledIn();
    await settle();
    await user.click(await screen.findByRole("button", { name: "Bewerbung abschicken" }));
    await settle();

    const keys = keysSent();
    assert.equal(keys.length, 2, "the form did not send both presses");
    assert.notEqual(keys[1], keys[0], "the press after a refusal replayed the refused request");
  });

  /* A sentence alone is either an answer that judged nothing, whose write may stand, or the refusal
     saying the first details stand: a fresh key would store a second application behind either. */
  for (const [answer, body] of [
    ["the refusal saying the first details stand", { success: false, error: "Deine Bewerbung ist schon angekommen." }],
    ["an answer that judged nothing", { success: false, error: "Der Server hat mit einem Fehler geantwortet. Versuche es erneut." }],
  ] as const) {
    it(`keeps its key after ${answer}`, async () => {
      answering(body);

      const user = await pressFilledIn();
      await settle();
      await user.click(await screen.findByRole("button", { name: "Bewerbung abschicken" }));
      await settle();

      const keys = keysSent();
      assert.equal(keys.length, 2, "the form did not send both presses");
      assert.equal(keys[1], keys[0], "the second press carried a key of its own, so it would store a second application");
    });
  }

  /* The request may have reached the route before the connection broke: a fresh key would store a
     second application behind the first. */
  it("keeps its key after an unread answer", async () => {
    fetchMock.mock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));

    const user = await pressFilledIn();
    await settle();
    await user.click(await screen.findByRole("button", { name: "Bewerbung abschicken" }));
    await settle();

    const keys = keysSent();
    assert.equal(keys.length, 2, "the form did not send both presses");
    assert.equal(keys[1], keys[0], "the second press carried a key of its own, so it would store a second application");
  });

  it("gives every mount a key of its own", async () => {
    answering({ success: true, message: "" });

    for (let mount = 0; mount < 2; mount += 1) {
      await pressFilledIn();
      await settle();
      cleanup();
    }

    const keys = keysSent();
    assert.equal(keys.length, 2);
    assert.notEqual(keys[0], keys[1], "two applications share a key, so the second would be answered as the first");
  });
});
