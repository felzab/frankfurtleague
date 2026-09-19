import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { bestaetigungsStand } from "@/features/bewerbungen/bestaetigungStand.ts";
import { FLBewerbungKontaktEmailPayloadSchema } from "@/features/bewerbungen/schemas.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { toFieldErrors } from "@/shared/utils/validation.ts";

import type { SitzBestaetigung } from "@/features/bewerbungen/bestaetigungStand.ts";
import type { FLBewerbung } from "@/features/bewerbungen/schemas.ts";

type Answer = { success: boolean; message?: string; error?: string; verschickt?: boolean };

/** The strip's two writes, replaced at the module boundary: a real one needs a session and a backend. */
const { calls, answerWith } = doubleActions({
  modules: ["/src/features/bewerbungen/actions.ts"],
  answer: () => new Promise(() => undefined),
});

const { raised } = doubleToasts();

const { BewerbungBestaetigungStrip } = await import("./BewerbungBestaetigungStrip.tsx");

const { router, seen } = recordingRouter();

/** How often one write ran, the double recording both of the strip's under one roster. */
const ran = (action: string): number => calls.filter((call) => call.action === action).length;

/** What one severity was titled, in the order the strip raised it. */
const titles = (variant: string): string[] => raised.filter((toast) => toast.variant === variant).map((toast) => toast.title);

beforeEach(() => {
  calls.length = 0;
  raised.length = 0;
  seen.refresh = 0;
  answerWith(() => new Promise(() => undefined));
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
function standsOf({
  kontakte = {},
  status = "eingereicht",
}: { kontakte?: Partial<FLBewerbung["kontakte"]>; status?: FLBewerbung["status"] } = {}) {
  const stands = bestaetigungsStand({
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

  assert.ok(stands !== null, "the fixture carries no confirmation block, so nothing below is judged");
  return stands;
}

function renderStrip({
  stands = standsOf(),
  frist = "2099-12-31",
  isOpen = true,
}: { stands?: SitzBestaetigung[]; frist?: string; isOpen?: boolean } = {}) {
  return render(
    underNext(h(BewerbungBestaetigungStrip, { bewerbungId: "68d0f2a4c1e2b3a4d5e6f708", staende: stands, frist, isOpen }), { router }),
  );
}

const pencil = (name: string) => screen.queryByRole("button", { name: `E-Mail-Adresse von ${name} korrigieren` });
const send = (rolle: string) => screen.queryByRole("button", { name: `Link erneut senden an ${rolle}` });
const addressBox = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Neue E-Mail-Adresse" });

/** The schema's own sentence for an address, so a case follows its wording rather than a copy of it. */
const schemaSentence = (email: string): string => {
  const result = FLBewerbungKontaktEmailPayloadSchema.safeParse({ id: "68d0f2a4c1e2b3a4d5e6f708", rolle: "trainer", email });

  return result.success ? assert.fail(`the schema takes ${email}, so nothing here is refused`) : (toFieldErrors(result.error).email ?? "");
};

/** Opens Clara's row and types a new address into it. */
async function correctClara(user: ReturnType<typeof userEvent.setup>, email: string): Promise<void> {
  await user.click(pencil("Clara Meier") ?? assert.fail("a waiting seat offers no pencil"));
  await user.clear(addressBox());
  await user.type(addressBox(), email);
}

/** A write answering only when the case says so. */
function held(): { answer: () => Promise<Answer>; settle: (answer: Answer) => Promise<void> } {
  const waiting: ((answer: Answer) => void)[] = [];

  return {
    answer: () => new Promise((resolve) => waiting.push(resolve)),
    settle: (answer) =>
      act(async () => {
        waiting.shift()?.(answer);
      }),
  };
}

describe("the seat row's two controls", () => {
  /* One condition for both, because the correction ends in a re-sent link: a seat no link can reach has
     nothing to correct towards. */
  it("stand on a waiting seat of an open application, and on no confirmed seat or decided application", () => {
    const { unmount } = renderStrip();

    assert.ok(pencil("Clara Meier") && send("Trainer"), "a waiting seat on an open application lacks a control");
    assert.ok(!pencil("Anna Meier") && !send("Ansprechperson"), "a confirmed seat is offered a link");
    unmount();

    renderStrip({ isOpen: false });
    assert.ok(!pencil("Clara Meier") && !send("Trainer"), "a decided application offers a link");
  });

  /* `docs/frontend/spec.md :: I66` gives a panel one action row: the open editor takes its own row's two
     controls, leaves every other row's, and closes when another row opens one. */
  it("give way to one editor for the whole strip", async () => {
    const user = userEvent.setup();
    renderStrip();

    await user.click(pencil("Clara Meier") ?? assert.fail("a waiting seat offers no pencil"));
    assert.ok(!pencil("Clara Meier") && !send("Trainer"), "the open row keeps its controls beside the editor");
    assert.ok(send("Stellvertretung"), "another row loses its controls to the editor");

    await user.click(pencil("Bernd Meier") ?? assert.fail("another row loses its pencil to the editor"));
    assert.equal(screen.getAllByRole("textbox", { name: "Neue E-Mail-Adresse" }).length, 1, "two rows hold an open editor at once");
    assert.ok(pencil("Clara Meier"), "the row opened first stays open beside the second");
  });
});

describe("the re-send on a seat with no address", () => {
  /* The action refuses it every time, so the press was an offer of nothing. Closed on the control and
     named by the seat, with the pencil beside it left open as the way out. */
  it("closes with a reason naming the correction, which stays open", () => {
    renderStrip({ stands: standsOf({ kontakte: { trainer: person("Clara", "") } }) });
    const withoutAddress = "Zu dieser Rolle steht keine E-Mail-Adresse in der Bewerbung. Trage zuerst eine über „Adresse korrigieren“ ein.";

    closedControl("Link erneut senden an Trainer", withoutAddress);
    assert.equal(isInTheFlow(withoutAddress), false, "the reason stands in the flow, which this row takes away with its controls");
    assert.equal(pencil("Clara Meier")?.hasAttribute("disabled"), false, "the pencil that would give the seat an address is closed");
  });
});

describe("the deadline sentence", () => {
  /* The sweep's clock reads `eingereicht` alone: a promise of deletion over a decided application is one
     nothing will keep, and a deadline behind today worded as ahead promises a deletion already owed. */
  it("says a passed deadline has passed while the application is open, and nothing once it is decided", () => {
    const { unmount } = renderStrip({ frist: "2020-01-01" });

    assert.ok(screen.queryByText(/^Die Frist für die Bestätigungen ist am 01\.01\.2020 abgelaufen\./), "a passed deadline is worded as ahead");
    unmount();

    renderStrip({ stands: standsOf({ status: "abgelehnt" }), isOpen: false });
    assert.ok(screen.queryByText(/gelöscht|Frist/) === null, "a decided application is promised a deletion");
  });
});

describe("the address correction", () => {
  /* A press that corrects nothing is a re-send wearing another name, and the re-send has its own control.
     Prefilled, because the commonest correction is one wrong character. */
  it("opens on the stored address, closed until another one is typed, and closed over no address at all", async () => {
    for (const trainer of [person("Clara", "clara@schule.example"), person("Clara", "")]) {
      const user = userEvent.setup();
      const { unmount } = renderStrip({ stands: standsOf({ kontakte: { trainer } }) });

      await user.click(pencil("Clara Meier") ?? assert.fail("a waiting seat offers no pencil"));

      assert.equal(addressBox().value, trainer.email);
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

    await correctClara(user, "clara@");
    assert.ok(screen.queryByText(schemaSentence("clara@")) === null, "the box judged an address still being typed");

    await user.tab();
    assert.ok(screen.queryByText(schemaSentence("clara@")), "leaving the box says nothing about the address in it");

    await user.type(addressBox(), "{Enter}");
    assert.equal(ran("kontaktEmailKorrigierenAction"), 0, "a refused address reaches the write");
  });

  /* Judged before anything is sent, so the administrator is told at the field; the backend refuses it
     regardless. */
  it("refuses another person's address at the field, and sends nothing", async () => {
    const user = userEvent.setup();
    renderStrip();

    await correctClara(user, "Bernd@Schule.example{Enter}");
    assert.ok(
      screen.queryByText("Diese E-Mail-Adresse ist schon bei einer anderen Person eingetragen."),
      "the box says nothing of the taken address",
    );
    assert.equal(ran("kontaktEmailKorrigierenAction"), 0, "an address another person holds reaches the write");
  });

  /* The seat's own mirror is the same person, whose address is no other person's. */
  it("takes the address the seat's own mirror holds", async () => {
    const user = userEvent.setup();
    renderStrip({
      stands: standsOf({
        kontakte: {
          ansprechperson: person("Anna", "anna.neu@schule.example"),
          trainer: person("Anna", "anna@schule.example"),
          trainer_ist_zugleich: "ansprechperson",
        },
      }),
    });

    await user.click(pencil("Anna Meier") ?? assert.fail("the pair's person is offered no pencil"));
    await user.clear(addressBox());
    await user.type(addressBox(), "anna.neu@schule.example{Enter}");

    assert.deepEqual(
      calls.filter((call) => call.action === "kontaktEmailKorrigierenAction").map((call) => (call.payload as { email: string }).email),
      ["anna.neu@schule.example"],
      "the mirror's address is refused as another person's",
    );
  });

  /* A pending submit button stops being a submit button, so `Enter` in the box submits the form by itself,
     and a second correction to an address already stored is refused. */
  it("sends one correction however often Enter is pressed while it runs", async () => {
    const user = userEvent.setup();
    renderStrip();

    await correctClara(user, "clara.neu@schule.example{Enter}");
    await user.type(addressBox(), "{Enter}");

    assert.equal(ran("kontaktEmailKorrigierenAction"), 1, "a second Enter while the write runs sent it again");
  });
});

describe("where focus goes as the correction box opens and closes", () => {
  /* Each press unmounts the control a keyboard user is standing on — the pencil as the box opens, the
     box's input as it closes — and a browser then drops focus on the document body. */
  it("moves into the new address on opening, and back to the row's pencil on closing", async () => {
    const user = userEvent.setup();
    renderStrip();

    await user.click(pencil("Clara Meier") ?? assert.fail("a waiting seat offers no pencil"));
    assert.ok(document.activeElement === addressBox(), "opening the box leaves focus outside its field");

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    assert.ok(document.activeElement === pencil("Clara Meier"), "closing the box leaves focus somewhere other than the pencil that opened it");
  });
});

describe("two re-sends running at once", () => {
  /* Each seat's control is held for exactly as long as its own write runs: another seat's settling must
     not lift it. */
  it("keeps each seat held for its own write, whatever the other seat's write does", async () => {
    const user = userEvent.setup();
    const { answer, settle } = held();
    answerWith(answer);
    renderStrip();

    await user.click(send("Stellvertretung") ?? assert.fail("Bernd is offered no re-send"));
    await user.click(send("Trainer") ?? assert.fail("Clara is offered no re-send"));
    assert.deepEqual([send("Stellvertretung")?.textContent, send("Trainer")?.textContent], ["Sendet...", "Sendet..."]);

    await settle({ success: true, message: "Der neue Link ging an bernd@schule.example." });
    assert.equal(send("Stellvertretung")?.textContent, "Link erneut senden", "a settled write left its seat held");
    assert.equal(send("Trainer")?.textContent, "Sendet...", "the first write's answer lifted the second seat's hold");
  });
});

describe("a write whose answer never arrives", () => {
  /* Awaited outside a transition, a rejected action reaches no error boundary: without the catch it
     leaves „Sendet...“ standing for good and says nothing. */
  it("releases the re-send, refreshes the row and says the outcome is unknown", async () => {
    const user = userEvent.setup();
    answerWith(() => Promise.reject(new TypeError("Failed to fetch")));
    renderStrip();

    await user.click(send("Trainer") ?? assert.fail("Clara is offered no re-send"));

    assert.equal(send("Trainer")?.textContent, "Link erneut senden", "the rejected write left „Sendet...“ standing");
    assert.equal(seen.refresh, 1, "a write that may have committed leaves the row as it was");
    assert.deepEqual(titles("danger"), ["Unklar, ob es bei uns angekommen ist"]);
  });

  /* The answered arms beside it, so the catch cannot have swallowed the ordinary outcomes. */
  it("still reports a refused re-send and a sent one as themselves", async () => {
    const user = userEvent.setup();
    renderStrip();

    answerWith(() => Promise.resolve({ success: false, error: "Die Bewerbung ist entschieden." }));
    await user.click(send("Trainer") ?? assert.fail("Clara is offered no re-send"));
    answerWith(() => Promise.resolve({ success: true, message: "Der neue Link ging raus." }));
    await user.click(send("Trainer") ?? assert.fail("Clara is offered no re-send"));

    assert.deepEqual(titles("danger"), ["Link nicht erneut gesendet"]);
    assert.deepEqual(titles("success"), ["Link erneut gesendet"]);
  });

  it("releases the correction and keeps the box open over its draft", async () => {
    const user = userEvent.setup();
    answerWith(() => Promise.reject(new TypeError("Failed to fetch")));
    renderStrip();

    await correctClara(user, "clara.neu@schule.example{Enter}");

    assert.equal(addressBox().value, "clara.neu@schule.example", "the draft a second press would send is gone");
    assert.ok(screen.getByRole("button", { name: "Korrigieren und Link senden" }), "the rejected write left „Sendet...“ standing");
    assert.equal(seen.refresh, 1);
    assert.deepEqual(titles("danger"), ["Unklar, ob es bei uns angekommen ist"]);
  });
});
