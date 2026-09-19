import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it, mock } from "node:test";

import { act, createElement as h } from "react";
/* `useRouter` reads a context no `next/navigation` export carries, so the strip renders under the one
   Next keeps it on. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { bestaetigungsStand } from "@/features/bewerbungen/bestaetigungStand.ts";
import { FLBewerbungKontaktEmailPayloadSchema } from "@/features/bewerbungen/schemas.ts";
import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";
import { toFieldErrors } from "@/shared/utils/validation.ts";

import type { SitzBestaetigung } from "@/features/bewerbungen/bestaetigungStand.ts";
import type { FLBewerbung } from "@/features/bewerbungen/schemas.ts";
import type { ContextType } from "react";

type Antwort = { success: boolean; message?: string; error?: string; verschickt?: boolean };

const einwilligungErneutSendenAction = mock.fn<(payload: { rolle: string }) => Promise<Antwort>>();
const kontaktEmailKorrigierenAction = mock.fn<(payload: { email: string }) => Promise<Antwort>>();
const appToast = { success: mock.fn(), warning: mock.fn(), danger: mock.fn(), info: mock.fn() };
Reflect.set(globalThis, "__flStrip", { einwilligungErneutSendenAction, kontaktEmailKorrigierenAction, appToast });

/* The strip's two writes and its toasts, replaced at the module boundary by the mocks above: a real action
   needs a session and a backend, and the real toast module raises into HeroUI's queue rather than back to the case. */
registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/features/bewerbungen/actions.ts"))
      return {
        format: "module",
        source: "export const { einwilligungErneutSendenAction, kontaktEmailKorrigierenAction } = globalThis.__flStrip;",
        shortCircuit: true,
      };
    if (url.endsWith("/src/shared/utils/appToast.ts"))
      return { format: "module", source: "export const { appToast } = globalThis.__flStrip;", shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { BewerbungBestaetigungStrip } = await import("./BewerbungBestaetigungStrip.tsx");

const refresh = mock.fn();

const ROUTER: NonNullable<ContextType<typeof AppRouterContext>> = {
  back: () => undefined,
  forward: () => undefined,
  refresh: refresh,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "bestaetigungStrip",
};

beforeEach(() => {
  for (const fn of [einwilligungErneutSendenAction, kontaktEmailKorrigierenAction, refresh, ...Object.values(appToast)]) {
    fn.mock.resetCalls();
    fn.mock.restore();
  }
});

const person = (vorname: string, email: string, bestaetigtAm: string | null = null): NonNullable<FLBewerbung["kontakte"]["trainer"]> => ({
  vorname: vorname,
  nachname: "Meier",
  email: email,
  telefon: "069 1234567",
  geburtsdatum: bestaetigtAm === null ? null : "1988-04-02",
  einwilligung: {
    umfang: "kontaktdaten",
    erfasst_von: bestaetigtAm === null ? "administrativ" : "person",
    text_version: "2026-09-bestaetigungsseite",
    datum: "2026-09-01",
    bestaetigt_am: bestaetigtAm,
  },
});

const OFFEN = { verschickt_am: "2026-09-01", erinnert_am: null, abgelehnt_am: null, zustellung: null };

/** Three seats, Anna confirmed and Bernd and Clara still waiting on their links. */
function staendeVon({
  kontakte = {},
  status = "eingereicht",
}: { kontakte?: Partial<FLBewerbung["kontakte"]>; status?: FLBewerbung["status"] } = {}) {
  const staende = bestaetigungsStand({
    kontakte: {
      ansprechperson: person("Anna", "anna@schule.example", "2026-09-02"),
      stellvertretung: person("Bernd", "bernd@schule.example"),
      trainer: person("Clara", "clara@schule.example"),
      trainer_ist_zugleich: null,
      ...kontakte,
    },
    bestaetigungen: { ansprechperson: OFFEN, stellvertretung: OFFEN, trainer: OFFEN },
    status: status,
  });

  assert.ok(staende !== null, "the fixture carries no confirmation block, so nothing below is judged");
  return staende;
}

function renderStrip({
  staende = staendeVon(),
  frist = "2099-12-31",
  isOpen = true,
}: { staende?: SitzBestaetigung[]; frist?: string; isOpen?: boolean } = {}) {
  return render(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(BewerbungBestaetigungStrip, { bewerbungId: "68d0f2a4c1e2b3a4d5e6f708", staende, frist, isOpen }),
    ),
  );
}

const stift = (name: string) => screen.queryByRole("button", { name: `E-Mail-Adresse von ${name} korrigieren` });
const senden = (rolle: string) => screen.queryByRole("button", { name: `Link erneut senden an ${rolle}` });
const adressfeld = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Neue E-Mail-Adresse" });

/** The schema's own sentence for an address, so a case follows its wording rather than a copy of it. */
const schemaSatz = (email: string): string => {
  const result = FLBewerbungKontaktEmailPayloadSchema.safeParse({ id: "68d0f2a4c1e2b3a4d5e6f708", rolle: "trainer", email });

  return result.success ? assert.fail(`the schema takes ${email}, so nothing here is refused`) : (toFieldErrors(result.error).email ?? "");
};

/** Opens Clara's row and types a new address into it. */
async function korrigiereClara(user: ReturnType<typeof userEvent.setup>, email: string): Promise<void> {
  await user.click(stift("Clara Meier") ?? assert.fail("a waiting seat offers no pencil"));
  await user.clear(adressfeld());
  await user.type(adressfeld(), email);
}

/** A write answering that arrives only when the case says so. */
function gehalten(): { antwort: () => Promise<Antwort>; beantworte: (antwort: Antwort) => Promise<void> } {
  const offen: ((antwort: Antwort) => void)[] = [];

  return {
    antwort: () => new Promise((resolve) => offen.push(resolve)),
    beantworte: (antwort) =>
      act(async () => {
        offen.shift()?.(antwort);
      }),
  };
}

describe("the seat row's two controls", () => {
  /* One condition for both, because the correction ends in a re-sent link: a seat no link can reach has
     nothing to correct towards. */
  it("stand on a waiting seat of an open application, and on no confirmed seat or decided application", () => {
    const { unmount } = renderStrip();

    assert.ok(stift("Clara Meier") && senden("Trainer"), "a waiting seat on an open application lacks a control");
    assert.ok(!stift("Anna Meier") && !senden("Ansprechperson"), "a confirmed seat is offered a link");
    unmount();

    renderStrip({ isOpen: false });
    assert.ok(!stift("Clara Meier") && !senden("Trainer"), "a decided application offers a link");
  });

  /* `docs/frontend/spec.md :: I66` gives a panel one action row: the open editor takes its own row's two
     controls, leaves every other row's, and closes when another row opens one. */
  it("give way to one editor for the whole strip", async () => {
    const user = userEvent.setup();
    renderStrip();

    await user.click(stift("Clara Meier") ?? assert.fail("a waiting seat offers no pencil"));
    assert.ok(!stift("Clara Meier") && !senden("Trainer"), "the open row keeps its controls beside the editor");
    assert.ok(senden("Stellvertretung"), "another row loses its controls to the editor");

    await user.click(stift("Bernd Meier") ?? assert.fail("another row loses its pencil to the editor"));
    assert.equal(screen.getAllByRole("textbox", { name: "Neue E-Mail-Adresse" }).length, 1, "two rows hold an open editor at once");
    assert.ok(stift("Clara Meier"), "the row opened first stays open beside the second");
  });
});

describe("the re-send on a seat with no address", () => {
  /* The action refuses it every time, so the press was an offer of nothing. Closed on the control and
     named by the seat, with the pencil beside it left open as the way out. */
  it("closes with a reason naming the correction, which stays open", () => {
    renderStrip({ staende: staendeVon({ kontakte: { trainer: person("Clara", "") } }) });
    const ohneAdresse = "Zu dieser Rolle steht keine E-Mail-Adresse in der Bewerbung. Trage zuerst eine über „Adresse korrigieren“ ein.";

    closedControl("Link erneut senden an Trainer", ohneAdresse);
    assert.equal(isInTheFlow(ohneAdresse), false, "the reason stands in the flow, which this row takes away with its controls");
    assert.equal(stift("Clara Meier")?.hasAttribute("disabled"), false, "the pencil that would give the seat an address is closed");
  });
});

describe("the deadline sentence", () => {
  /* The sweep's clock reads `eingereicht` alone: a promise of deletion over a decided application is one
     nothing will keep, and a deadline behind today worded as ahead promises a deletion already owed. */
  it("says a passed deadline has passed while the application is open, and nothing once it is decided", () => {
    const { unmount } = renderStrip({ frist: "2020-01-01" });

    assert.ok(screen.queryByText(/^Die Frist für die Bestätigungen ist am 01\.01\.2020 abgelaufen\./), "a passed deadline is worded as ahead");
    unmount();

    renderStrip({ staende: staendeVon({ status: "abgelehnt" }), isOpen: false });
    assert.equal(screen.queryByText(/gelöscht|Frist/), null, "a decided application is promised a deletion");
  });
});

describe("the address correction", () => {
  /* A press that corrects nothing is a re-send wearing another name, and the re-send has its own control.
     Prefilled, because the commonest correction is one wrong character. */
  it("opens on the stored address, closed until another one is typed, and closed over no address at all", async () => {
    for (const trainer of [person("Clara", "clara@schule.example"), person("Clara", "")]) {
      const user = userEvent.setup();
      const { unmount } = renderStrip({ staende: staendeVon({ kontakte: { trainer } }) });

      await user.click(stift("Clara Meier") ?? assert.fail("a waiting seat offers no pencil"));

      assert.equal(adressfeld().value, trainer.email);
      closedControl("Korrigieren und Link senden", "Gib zuerst eine andere E-Mail-Adresse ein.");
      assert.equal(isInTheFlow("Gib zuerst eine andere E-Mail-Adresse ein."), false, "the reason stands where a keystroke unmounts it");
      unmount();
    }
  });

  /* `.claude/rules/frontend.md` **forms**: a message between two keystrokes describes an address nobody
     finished typing. */
  it("judges a typed address when the box is left and at the press, never between keystrokes, and sends nothing it refuses", async () => {
    const user = userEvent.setup();
    renderStrip();

    await korrigiereClara(user, "clara@");
    assert.equal(screen.queryByText(schemaSatz("clara@")), null, "the box judged an address still being typed");

    await user.tab();
    assert.ok(screen.queryByText(schemaSatz("clara@")), "leaving the box says nothing about the address in it");

    await user.type(adressfeld(), "{Enter}");
    assert.equal(kontaktEmailKorrigierenAction.mock.callCount(), 0, "a refused address reaches the write");
  });

  /* Judged before anything is sent, so the administrator is told at the field; the backend refuses it
     regardless. */
  it("refuses another person's address at the field, and sends nothing", async () => {
    const user = userEvent.setup();
    renderStrip();

    await korrigiereClara(user, "Bernd@Schule.example{Enter}");
    assert.ok(
      screen.queryByText("Diese E-Mail-Adresse ist schon bei einer anderen Person eingetragen."),
      "the box says nothing of the taken address",
    );
    assert.equal(kontaktEmailKorrigierenAction.mock.callCount(), 0, "an address another person holds reaches the write");
  });

  /* The seat's own mirror is the same person, whose address is no other person's. */
  it("takes the address the seat's own mirror holds", async () => {
    const user = userEvent.setup();
    kontaktEmailKorrigierenAction.mock.mockImplementation(() => new Promise(() => undefined));
    renderStrip({
      staende: staendeVon({
        kontakte: {
          ansprechperson: person("Anna", "anna.neu@schule.example"),
          trainer: person("Anna", "anna@schule.example"),
          trainer_ist_zugleich: "ansprechperson",
        },
      }),
    });

    await user.click(stift("Anna Meier") ?? assert.fail("the pair's person is offered no pencil"));
    await user.clear(adressfeld());
    await user.type(adressfeld(), "anna.neu@schule.example{Enter}");

    assert.deepEqual(
      kontaktEmailKorrigierenAction.mock.calls.map(({ arguments: [payload] }) => payload.email),
      ["anna.neu@schule.example"],
      "the mirror's address is refused as another person's",
    );
  });

  /* A pending submit button stops being a submit button, so `Enter` in the box submits the form by itself,
     and a second correction to an address already stored is refused. */
  it("sends one correction however often Enter is pressed while it runs", async () => {
    const user = userEvent.setup();
    kontaktEmailKorrigierenAction.mock.mockImplementation(() => new Promise(() => undefined));
    renderStrip();

    await korrigiereClara(user, "clara.neu@schule.example{Enter}");
    await user.type(adressfeld(), "{Enter}");

    assert.equal(kontaktEmailKorrigierenAction.mock.callCount(), 1, "a second Enter while the write runs sent it again");
  });
});

describe("where focus goes as the correction box opens and closes", () => {
  /* Each press unmounts the control a keyboard user is standing on — the pencil as the box opens, the
     box's input as it closes — and a browser then drops focus on the document body. */
  it("moves into the new address on opening, and back to the row's pencil on closing", async () => {
    const user = userEvent.setup();
    renderStrip();

    await user.click(stift("Clara Meier") ?? assert.fail("a waiting seat offers no pencil"));
    assert.equal(document.activeElement, adressfeld(), "opening the box leaves focus outside its field");

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    assert.equal(document.activeElement, stift("Clara Meier"), "closing the box leaves focus somewhere other than the pencil that opened it");
  });
});

describe("two re-sends running at once", () => {
  /* Each seat's control is held for exactly as long as its own write runs: another seat's settling must
     not lift it. */
  it("keeps each seat held for its own write, whatever the other seat's write does", async () => {
    const user = userEvent.setup();
    const { antwort, beantworte } = gehalten();
    einwilligungErneutSendenAction.mock.mockImplementation(antwort);
    renderStrip();

    await user.click(senden("Stellvertretung") ?? assert.fail("Bernd is offered no re-send"));
    await user.click(senden("Trainer") ?? assert.fail("Clara is offered no re-send"));
    assert.deepEqual([senden("Stellvertretung")?.textContent, senden("Trainer")?.textContent], ["Sendet...", "Sendet..."]);

    await beantworte({ success: true, message: "Der neue Link ging an bernd@schule.example." });
    assert.equal(senden("Stellvertretung")?.textContent, "Link erneut senden", "a settled write left its seat held");
    assert.equal(senden("Trainer")?.textContent, "Sendet...", "the first write's answer lifted the second seat's hold");
  });
});

describe("a write whose answer never arrives", () => {
  /* Awaited outside a transition, a rejected action reaches no error boundary: without the catch it
     leaves „Sendet...“ standing for good and says nothing. */
  it("releases the re-send, refreshes the row and says the outcome is unknown", async () => {
    const user = userEvent.setup();
    einwilligungErneutSendenAction.mock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    renderStrip();

    await user.click(senden("Trainer") ?? assert.fail("Clara is offered no re-send"));

    assert.equal(senden("Trainer")?.textContent, "Link erneut senden", "the rejected write left „Sendet...“ standing");
    assert.equal(refresh.mock.callCount(), 1, "a write that may have committed leaves the row as it was");
    assert.deepEqual(
      appToast.danger.mock.calls.map(({ arguments: [title] }) => title),
      ["Unklar, ob es bei uns angekommen ist"],
    );
  });

  /* The answered arms beside it, so the catch cannot have swallowed the ordinary outcomes. */
  it("still reports a refused re-send and a sent one as themselves", async () => {
    const user = userEvent.setup();
    renderStrip();

    einwilligungErneutSendenAction.mock.mockImplementationOnce(() =>
      Promise.resolve({ success: false, error: "Die Bewerbung ist entschieden." }),
    );
    await user.click(senden("Trainer") ?? assert.fail("Clara is offered no re-send"));
    einwilligungErneutSendenAction.mock.mockImplementationOnce(() => Promise.resolve({ success: true, message: "Der neue Link ging raus." }));
    await user.click(senden("Trainer") ?? assert.fail("Clara is offered no re-send"));

    assert.deepEqual(
      appToast.danger.mock.calls.map(({ arguments: [title] }) => title),
      ["Link nicht erneut gesendet"],
    );
    assert.deepEqual(
      appToast.success.mock.calls.map(({ arguments: [title] }) => title),
      ["Link erneut gesendet"],
    );
  });

  it("releases the correction and keeps the box open over its draft", async () => {
    const user = userEvent.setup();
    kontaktEmailKorrigierenAction.mock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    renderStrip();

    await korrigiereClara(user, "clara.neu@schule.example{Enter}");

    assert.equal(adressfeld().value, "clara.neu@schule.example", "the draft a second press would send is gone");
    assert.ok(screen.getByRole("button", { name: "Korrigieren und Link senden" }), "the rejected write left „Sendet...“ standing");
    assert.equal(refresh.mock.callCount(), 1);
    assert.deepEqual(
      appToast.danger.mock.calls.map(({ arguments: [title] }) => title),
      ["Unklar, ob es bei uns angekommen ist"],
    );
  });
});
