import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { LIGA_KENNTNISNAHME } from "@/core/einwilligung.ts";
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
const { calls, answerWith, answerPending } = doubleActions({
  modules: ["/src/features/bewerbungen/actions.ts"],
  answer: () => new Promise(() => undefined),
});

const { raised } = doubleToasts();

const { BewerbungBestaetigungStrip } = await import("./BewerbungBestaetigungStrip.tsx");
const { BestaetigungHinweise } = await import("./BestaetigungHinweise.tsx");

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

/** What a Widerspruch leaves: the entry carrying the day, beside a slot the decline nulled. */
const WIDERSPRUCH = { ...OFFEN, abgelehnt_am: "2026-09-03" };

/** Three seats, Anna confirmed and Bernd and Clara still waiting on their links. */
function standsOf({
  kontakte = {},
  bestaetigungen = {},
  status = "eingereicht",
}: {
  kontakte?: Partial<FLBewerbung["kontakte"]>;
  bestaetigungen?: Partial<NonNullable<FLBewerbung["bestaetigungen"]>>;
  status?: FLBewerbung["status"];
} = {}) {
  const stands = bestaetigungsStand({
    kontakte: {
      ansprechperson: person("Anna", "anna@schule.example", "2026-09-02"),
      stellvertretung: person("Bernd", "bernd@schule.example"),
      trainer: person("Clara", "clara@schule.example"),
      trainer_ist_zugleich: null,
      ...kontakte,
    },
    bestaetigungen: { ansprechperson: OFFEN, stellvertretung: OFFEN, trainer: OFFEN, ...bestaetigungen },
    status: status,
  });

  assert.ok(stands !== null, "the fixture carries no confirmation block, so nothing below is judged");
  return stands;
}

/** The state the reseat runs on: Clara stepped out of the Trainer seat, leaving it empty. */
const claraStieAus = { kontakte: { trainer: null }, bestaetigungen: { trainer: WIDERSPRUCH } };

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
const reseat = (rolle: string) => screen.queryByRole("button", { name: `${rolle} neu besetzen` });
const addressBox = () => screen.getByRole<HTMLInputElement>("textbox", { name: "Neue E-Mail-Adresse" });

/** Fills the reseat box with a whole person, the address last so a case can press Enter in it. */
async function seatSomebody(user: ReturnType<typeof userEvent.setup>, rolle: string, email: string): Promise<void> {
  await user.click(reseat(rolle) ?? assert.fail(`${rolle} offers no way to seat another person`));
  await user.type(screen.getByRole("textbox", { name: "Vorname" }), "Doreen");
  await user.type(screen.getByRole("textbox", { name: "Nachname" }), "Ostwald");
  await user.type(screen.getByRole("textbox", { name: "Telefon" }), "069 7654321");
  await user.type(screen.getByRole("textbox", { name: "E-Mail" }), email);
}

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
    await act(async () => answerPending({ success: true, message: "Der neue Link ging an anna.neu@schule.example." }));
  });

  /* The sign-in fold reads the two as one person, and the mail goes to the bytes stored: a stored
     capital before the at sign is a repair to send. */
  it("sends a correction whose only change the sign-in fold would erase", async () => {
    const user = userEvent.setup();
    renderStrip({ stands: standsOf({ kontakte: { trainer: person("Clara", "Clara@schule.example") } }) });

    await correctClara(user, "clara@schule.example{Enter}");

    assert.equal(ran("kontaktEmailKorrigierenAction"), 1, "the press stayed closed over a delivery target that moved");
    await act(async () => answerPending({ success: true, message: "Der neue Link ging an clara@schule.example." }));
  });

  /* A pending submit button stops being a submit button, so `Enter` in the box submits the form by itself,
     and a second correction to an address already stored is refused. */
  it("sends one correction however often Enter is pressed while it runs", async () => {
    const user = userEvent.setup();
    renderStrip();

    await correctClara(user, "clara.neu@schule.example{Enter}");
    await user.type(addressBox(), "{Enter}");

    assert.equal(ran("kontaktEmailKorrigierenAction"), 1, "a second Enter while the write runs sent it again");
    await act(async () => answerPending({ success: true, message: "Der neue Link ging an clara.neu@schule.example." }));
  });

  it("reports a refusal, a sent link and an address corrected behind a message that did not go", async () => {
    const user = userEvent.setup();

    for (const answer of [
      { success: false, error: "Die Bewerbung ist entschieden." },
      { success: true, verschickt: false, message: "Der Link ging nicht raus." },
      { success: true, verschickt: true, message: "Der Link ging an clara.neu@schule.example." },
    ]) {
      const { unmount } = renderStrip();
      answerWith(() => Promise.resolve(answer));

      await correctClara(user, "clara.neu@schule.example{Enter}");
      unmount();
    }

    // Its own title rather than the editors' „Änderung nicht gespeichert“, which a sentence-only
    // refusal would otherwise reach through the hook's default raise.
    assert.deepEqual(titles("danger"), ["Adresse nicht korrigiert"]);
    assert.deepEqual(titles("warning"), ["Link nicht gesendet"]);
    assert.deepEqual(titles("success"), ["Adresse korrigiert"]);
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
    await settle({ success: true, message: "Der neue Link ging an clara@schule.example." });
  });
});

/** What each toast raised over a write of unknown outcome was titled and said. */
const unknowns = (): string[][] =>
  raised.filter((toast) => toast.options?.outcome === "unknown").map((toast) => [toast.title, toast.description ?? ""]);

/** The sentence an admin write's answered unknown outcome carries, which every control shows as it stands. */
const ANSWERED = "Ob die Änderung gespeichert wurde, ist unklar. Lade die Seite neu und prüfe, ob sie da ist.";

/**
 * The two ways a write nobody can tell landed arrives: the action rejecting, which carries no status and no
 * body, and the action answering that the commit's own answer was lost. One toast for both.
 */
const UNCLEAR_ARMS: Record<string, () => Promise<unknown>> = {
  thrown: () => Promise.reject(new TypeError("Failed to fetch")),
  answered: () => Promise.resolve({ success: false, error: ANSWERED, outcome: "unknown" }),
};

/** What the toast over each arm says: the control's own repair where the action threw, the answer's sentence where it answered. */
const repairOn = (arm: string, own: string): string => (arm === "thrown" ? own : ANSWERED);

describe("a write whose answer never arrives", () => {
  /* Awaited outside a transition, a rejected action reaches no error boundary: without the catch it
     leaves „Sendet...“ standing for good and says nothing. */
  for (const [arm, answer] of Object.entries(UNCLEAR_ARMS)) {
    it(`releases the re-send, refreshes the row and says the outcome is unknown, ${arm}`, async () => {
      const user = userEvent.setup();
      answerWith(answer);
      renderStrip();

      await user.click(send("Trainer") ?? assert.fail("Clara is offered no re-send"));

      assert.equal(send("Trainer")?.textContent, "Link erneut senden", "the rejected write left „Sendet...“ standing");
      assert.equal(seen.refresh, 1, "a write that may have committed leaves the row as it was");
      assert.deepEqual(unknowns(), [
        [
          "Link nicht erneut gesendet",
          repairOn(arm, "Prüfe die Verbindung und sende den Link noch einmal. Ein neuer Link ersetzt einen, der schon rausging."),
        ],
      ]);
      assert.equal(raised.length, 1, "one press raised more than one toast");
    });
  }

  /* The answered arms beside it, so the catch cannot have swallowed the ordinary outcomes. */
  it("still reports a refused re-send and a sent one as themselves", async () => {
    const user = userEvent.setup();
    renderStrip();

    answerWith(() => Promise.resolve({ success: false, error: "Die Bewerbung ist entschieden." }));
    await user.click(send("Trainer") ?? assert.fail("Clara is offered no re-send"));
    answerWith(() => Promise.resolve({ success: true, message: "Der neue Link ging raus." }));
    await user.click(send("Trainer") ?? assert.fail("Clara is offered no re-send"));

    assert.deepEqual(titles("danger"), ["Link nicht erneut gesendet"]);
    assert.deepEqual(unknowns(), [], "a refusal was raised as a write of unknown outcome");
    assert.deepEqual(titles("success"), ["Link erneut gesendet"]);
    // Both answered, so a landed write came back refreshed by the action itself.
    assert.equal(seen.refresh, 0, "an answered re-send read the page a second time");
  });

  for (const [arm, answer] of Object.entries(UNCLEAR_ARMS)) {
    it(`releases the correction and keeps the box open over its draft, ${arm}`, async () => {
      const user = userEvent.setup();
      answerWith(answer);
      renderStrip();

      await correctClara(user, "clara.neu@schule.example{Enter}");

      assert.equal(addressBox().value, "clara.neu@schule.example", "the draft a second press would send is gone");
      assert.ok(screen.getByRole("button", { name: "Korrigieren und Link senden" }), "the rejected write left „Sendet...“ standing");
      assert.equal(seen.refresh, 1);
      assert.deepEqual(unknowns(), [
        [
          "Adresse nicht korrigiert",
          repairOn(arm, "Prüfe die Verbindung und lade die Seite neu. Steht in der Zeile noch die alte Adresse, korrigiere sie noch einmal."),
        ],
      ]);
      assert.equal(raised.length, 1, "one press raised more than one toast");
    });

    it(`releases the reseat and keeps its box open over the person typed into it, ${arm}`, async () => {
      const user = userEvent.setup();
      answerWith(answer);
      renderStrip({ stands: standsOf(claraStieAus) });

      await seatSomebody(user, "Trainer", "doreen@schule.example{Enter}");

      assert.ok(screen.getByRole("button", { name: "Neu besetzen und Link senden" }), "the rejected write left „Sendet...“ standing");
      assert.equal(
        screen.getByRole<HTMLInputElement>("textbox", { name: "Vorname" }).value,
        "Doreen",
        "the person a second press would send is gone",
      );
      assert.equal(seen.refresh, 1, "a write that may have committed leaves the row as it was");
      assert.deepEqual(unknowns(), [
        [
          "Rolle nicht neu besetzt",
          repairOn(arm, "Prüfe die Verbindung und lade die Seite neu. Steht in der Zeile noch niemand, besetze die Rolle noch einmal."),
        ],
      ]);
      assert.equal(raised.length, 1, "one press raised more than one toast");
    });
  }
});

describe("seating another person where one stepped out", () => {
  /* The one state this write runs on. A waiting seat still belongs to its person, a confirmed one has
     been answered, and a decided application's contact block is what the decision was taken against. */
  it("is offered on a seat its own person stepped out of, and on no other seat or decided application", () => {
    const { unmount } = renderStrip({ stands: standsOf(claraStieAus) });

    assert.ok(reseat("Trainer"), "the seat a Widerspruch emptied offers no way to seat anybody else");
    assert.ok(!reseat("Ansprechperson") && !reseat("Stellvertretung"), "a confirmed or waiting seat is offered to another person");
    assert.ok(!send("Trainer") && !pencil("Clara Meier"), "the emptied seat keeps the controls that need somebody in it");
    unmount();

    renderStrip({ stands: standsOf({ ...claraStieAus, status: "abgelehnt" }), isOpen: false });
    assert.ok(!reseat("Trainer"), "a decided application offers its emptied seat to another person");
  });

  /* One answer covers both seats and one link is minted for them, so a second control would put a second
     message in one mailbox over one decision. */
  it("gives one person holding two emptied seats a single control, on the Trainer's row", () => {
    renderStrip({
      stands: standsOf({
        kontakte: { trainer: null, ansprechperson: null, trainer_ist_zugleich: "ansprechperson" },
        bestaetigungen: { trainer: WIDERSPRUCH, ansprechperson: WIDERSPRUCH },
      }),
    });

    assert.ok(reseat("Trainer"), "the mirrored pair is offered no control at all");
    assert.ok(!reseat("Ansprechperson"), "one person's two seats each carry their own control");
  });

  /* The person reads the confirmation page and never the form, whose words address the submitter. */
  it("shows the confirmation page's opening words every person reads alike, in its order, and none of the form's", async () => {
    // Read off the page itself, rendered with a marker in every slot, so a paragraph the page adds,
    // drops or moves fails here rather than drifting from the box.
    const markiert = "MARKIERT-SLOT";
    const seite = render(
      underNext(h(BestaetigungHinweise, { schule: markiert, saison: markiert, rolle: markiert, mindestalter: 987, ablehnenLabel: markiert }), {
        router,
      }),
    );
    const seitenAbsaetze = [...seite.container.querySelectorAll("p, li")].map((absatz) => absatz.textContent ?? "");
    seite.unmount();

    const user = userEvent.setup();
    renderStrip({ stands: standsOf(claraStieAus) });
    await user.click(reseat("Trainer") ?? assert.fail("the emptied seat offers no control"));

    const kopf = screen.getByText("Diese Person bekommt den Bestätigungslink und wird dort gefragt:");
    const box = kopf.parentElement ?? assert.fail("the box's heading stands in no box");
    // Read off `textContent` rather than matched as one node: the linked notice splits the paragraph
    // that names it into three, and a node matcher then finds neither half.
    const gezeigt = [...box.querySelectorAll("p")].filter((absatz) => absatz !== kopf).map((absatz) => absatz.textContent ?? "");

    assert.notEqual(gezeigt.length, 0, "the box shows none of the page's words");
    assert.deepEqual(
      gezeigt,
      seitenAbsaetze.filter((absatz) => !absatz.includes(markiert) && !absatz.includes("987")),
      "the box shows other words than the page opens with, or in another order",
    );
    for (const absatz of LIGA_KENNTNISNAHME.absaetze) {
      assert.ok(
        !(box.textContent ?? "").includes(absatz),
        `the box shows the form's words to a person who never sees the form: ${absatz.slice(0, 40)}`,
      );
    }
    assert.ok(
      screen.getAllByRole("link", { name: "Datenschutzerklärung" }).length > 0,
      "the page links the notice and the box gives the reader no way to it",
    );
  });

  /* A whole person is written, so a half-filled box would seat somebody the league cannot reach. Closed on
     the control, with the reason where a keystroke does not unmount it. */
  it("is closed until all four fields carry something", async () => {
    const user = userEvent.setup();
    renderStrip({ stands: standsOf(claraStieAus) });

    await user.click(reseat("Trainer") ?? assert.fail("the emptied seat offers no control"));
    closedControl("Neu besetzen und Link senden", "Fülle zuerst alle vier Felder aus.");
    assert.equal(isInTheFlow("Fülle zuerst alle vier Felder aus."), false, "the reason stands where a keystroke unmounts it");

    await user.type(screen.getByRole("textbox", { name: "Vorname" }), "Doreen");
    closedControl("Neu besetzen und Link senden", "Fülle zuerst alle vier Felder aus.");
  });

  /* Judged before anything is sent, so the administrator is told at the field; the backend refuses it
     regardless (`REQ-BEWERBUNG-014`). */
  it("refuses another contact person's address at the field, and sends nothing", async () => {
    const user = userEvent.setup();
    renderStrip({ stands: standsOf(claraStieAus) });

    await seatSomebody(user, "Trainer", "Bernd@Schule.example{Enter}");

    assert.ok(screen.queryByText("Diese E-Mail-Adresse ist schon bei einer anderen Person eingetragen."), "the box takes a taken address");
    assert.equal(ran("besetzeKontaktSitzAction"), 0, "an address another person holds reaches the write");
  });

  /* The label is the registry's rather than anything typed, and it is what the new person's own
     confirmation page will then overwrite with the wording they were shown. */
  it("sends the typed person and the current Kenntnisnahme label, once however often Enter is pressed", async () => {
    const user = userEvent.setup();
    renderStrip({ stands: standsOf(claraStieAus) });

    await seatSomebody(user, "Trainer", "doreen@schule.example{Enter}");
    await user.type(screen.getByRole("textbox", { name: "E-Mail" }), "{Enter}");

    assert.equal(ran("besetzeKontaktSitzAction"), 1, "a second Enter while the write runs sent it again");
    assert.deepEqual(calls.find((call) => call.action === "besetzeKontaktSitzAction")?.payload, {
      id: "68d0f2a4c1e2b3a4d5e6f708",
      rolle: "trainer",
      vorname: "Doreen",
      nachname: "Ostwald",
      email: "doreen@schule.example",
      telefon: "069 7654321",
      text_version: LIGA_KENNTNISNAHME.textVersion,
    });
    await act(async () => answerPending({ success: true, verschickt: true, message: "Der Link ging an doreen@schule.example." }));
  });

  /* The seat stands filled whatever the message did, so the arm reporting a refused send must not read
     as a person who was never seated. */
  it("reports a refusal, a sent link and a seat filled behind a message that did not go", async () => {
    const user = userEvent.setup();

    for (const answer of [
      { success: false, error: "Die Bewerbung ist entschieden." },
      { success: true, verschickt: false, message: "Der Link ging nicht raus." },
      { success: true, verschickt: true, message: "Der Link ging an doreen@schule.example." },
    ]) {
      const { unmount } = renderStrip({ stands: standsOf(claraStieAus) });
      answerWith(() => Promise.resolve(answer));

      await seatSomebody(user, "Trainer", "doreen@schule.example{Enter}");
      unmount();
    }

    assert.deepEqual(titles("danger"), ["Rolle nicht neu besetzt"]);
    // Its own title rather than the correction's „Link nicht gesendet“: the two outcomes differ in
    // what stands afterwards.
    assert.deepEqual(titles("warning"), ["Rolle besetzt, Link nicht gesendet"]);
    assert.deepEqual(titles("success"), ["Rolle neu besetzt"]);
  });
});
