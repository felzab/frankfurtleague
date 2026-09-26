import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { bestaetigungsStand, zusageHindernis } from "@/features/bewerbungen/bestaetigungStand.ts";
import { FLBewerbungSchema } from "@/features/bewerbungen/schemas.ts";
import { doubleEveryAction, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { FLBewerbung } from "@/features/bewerbungen/schemas.ts";
import type { UserEvent } from "@testing-library/user-event";

const { calls } = doubleEveryAction();
const { raised } = doubleToasts();

const { AdminBewerbungView } = await import("./AdminBewerbungView.tsx");
// After the doubles: the guard raises its warning through the toast module they replace.
const { DRAFT_DISCARDED } = await import("@/shared/utils/draftGuard.ts");

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..", "..", "..");

/** The module the redaction lives in, and the triage router, whose calls say whether a decision redacts. */
const RECORDING = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "core", "recording.py"), "utf8");
const ADMIN_ROUTER = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "api", "bewerbungen", "admin_router.py"), "utf8");

const TEAM_NAME = "SG Alpha";

const person = (vorname: string, bestaetigtAm: string | null): NonNullable<FLBewerbung["kontakte"]["trainer"]> => ({
  vorname: vorname,
  nachname: "Meier",
  email: `${vorname.toLowerCase()}@schule.example`,
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

const SITZ = { verschickt_am: "2026-09-01", erinnert_am: null, abgelehnt_am: null, zustellung: null };

/**
 * An open application for an existing club whose three seats have all confirmed, so nothing closes
 * either decision. Parsed at construction: a drifted field fails here rather than in the page.
 */
const OFFEN: FLBewerbung = FLBewerbungSchema.parse({
  id: "68d0f2a4c1e2b3a4d5e6f708",
  saison_id: "2027",
  eingereicht_am: "2026-09-01",
  status: "eingereicht",
  team_id: "68d0f2a4c1e2b3a4d5e6f709",
  schule: null,
  kontakte: {
    ansprechperson: person("Anna", "2026-09-02"),
    stellvertretung: person("Bernd", "2026-09-02"),
    trainer: person("Clara", "2026-09-03"),
    trainer_ist_zugleich: null,
  },
  trikot: { vorhandener_satz: "Ein Satz", wunschfarbe: null },
  kader: { voraussichtliche_groesse: 14, gute_spieler: 2 },
  stufengroesse: 96,
  wunschgegner: null,
  entscheidung: null,
  bestaetigungen: { ansprechperson: SITZ, stellvertretung: SITZ, trainer: SITZ },
  bestaetigungsfrist: "2099-12-31",
} satisfies FLBewerbung);

function renderPage(bewerbung: FLBewerbung, teamName: string | null = TEAM_NAME) {
  return render(
    underNext(
      h(AdminBewerbungView, { bewerbung, teamName, saisonStatus: "future", gruppeOffer: [{ gruppe: "A", occupied: 1, capacity: 4 }] }),
      { search: "saison_id=2027" },
    ),
  );
}

/** Whether one decision stands on the page, which its own heading is what a reader meets it by. */
const offers = (heading: "Zusage" | "Absage"): boolean => screen.queryByRole("heading", { name: heading }) !== null;

describe("the Zusage where the write would be refused", () => {
  /* Withheld, the section sent the administrator looking for a decision the page still held. It stands
     and closes its own control instead (my rule, 2026-09-04). */
  it("stands whatever would refuse it, and says why on its own control", () => {
    for (const [bewerbung, teamName, wo] of [
      [{ ...OFFEN, kontakte: { ...OFFEN.kontakte, trainer: person("Clara", null) } }, TEAM_NAME, "a seat still unconfirmed"],
      [OFFEN, null, "an application naming no club"],
    ] as const) {
      const { unmount } = renderPage(bewerbung, teamName);
      const hindernis = zusageHindernis(bestaetigungsStand(bewerbung), teamName) ?? "";

      assert.notEqual(hindernis, "", `${wo} refuses nothing, so this case judges an open control`);
      assert.ok(offers("Zusage"), `the page withdraws the acceptance over ${wo}`);
      closedControl("Bewerbung annehmen", hindernis);
      unmount();
    }
  });

  it("offers neither decision once the application is decided", () => {
    renderPage({ ...OFFEN, status: "abgelehnt", entscheidung: { getroffen_am: "2026-09-10", von: "Admin", grund: "Kein Platz." } });

    // First: a page that rendered nothing holds neither panel either.
    assert.ok(screen.getByRole("heading", { name: TEAM_NAME }), "the decided application's page did not render");
    assert.equal(offers("Zusage"), false, "a decided application is offered an acceptance");
    assert.equal(offers("Absage"), false, "a decided application is offered a decline");
  });
});

describe("which irreversibility the triage claims", () => {
  /* `docs/frontend/spec.md` §1.3 splits the two sentences on one mechanical test: the second belongs to a
     write whose transaction empties the log rows it filed. Neither decision redacts, so the pre-image
     survives both and the FIRST sentence is theirs. */
  it("takes the sentence for a write the action log outlives", async () => {
    // Read where the redaction is written: whether a decision redacts is a call the backend router makes.
    assert.match(RECORDING, /def build_redaction_update/, "the redaction this test turns on is gone");
    assert.ok(!ADMIN_ROUTER.includes("build_redaction_update"), "the triage redacts, so the sentence below is the wrong one");

    const user = userEvent.setup();
    const { container } = renderPage(OFFEN);

    await user.selectOptions(container.querySelector('select[name="gruppe"]') ?? assert.fail("the acceptance offers no group"), "A");
    await user.click(screen.getByRole("button", { name: "Bewerbung annehmen" }));
    await user.type(screen.getByRole("textbox", { name: "Grund für die Absage" }), "Kein Platz.");
    await user.click(screen.getByRole("button", { name: "Bewerbung ablehnen" }));

    /* Both arming reveals, which announce themselves: the sentence is what each of the two promises,
       and the count is the floor under a loop that would otherwise pass over one panel that never armed. */
    const revealed = screen.getAllByRole("alert").map((reveal) => reveal.textContent);

    assert.equal(revealed.length, 2, "one of the two decisions did not arm, so the sentences below are read off the other");
    for (const armed of revealed) {
      assert.match(armed, /Es gibt in der Verwaltung keinen Weg zurück\./, "an armed decision drops the irreversibility sentence");
      assert.ok(
        !armed.includes("Zurückholen lässt sich das nicht"),
        "an armed decision claims the log is emptied, and no triage write empties one",
      );
    }
  });
});

describe("the Zusage beside a typed Absage", () => {
  /* The acceptance's refresh re-keys the page on the decided application, which throws the typed reason away
     unasked. The press arms over an empty reason, so the refusal below is the reason's alone. */
  it("refuses to arm while a reason stands typed, naming the reason's loss", async () => {
    const user = userEvent.setup();
    const armed = () => screen.queryByRole("button", { name: "Ja, Team verbindlich aufnehmen" });
    const pressAccept = async (container: HTMLElement) => {
      await user.selectOptions(container.querySelector('select[name="gruppe"]') ?? assert.fail("the acceptance offers no group"), "A");
      await user.click(screen.getByRole("button", { name: "Bewerbung annehmen" }));
    };

    const clean = renderPage(OFFEN);
    await pressAccept(clean.container);
    assert.ok(armed() !== null, "the acceptance does not arm over an empty reason, so the refusal below judges nothing");
    clean.unmount();

    const { container } = renderPage(OFFEN);
    await user.type(screen.getByRole("textbox", { name: "Grund für die Absage" }), "Kein Platz.");
    raised.length = 0;
    await pressAccept(container);

    assert.ok(armed() === null, "the acceptance armed over a typed reason");
    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title, toast.description]),
      [["warning", "Erst speichern", DRAFT_DISCARDED]],
    );
  });
});

/**
 * An open application whose Stellvertretung still waits on her link and whose Trainer declined, so the strip
 * offers its re-send, its correction and its reseat beside the decline.
 */
const MIT_OFFENEN_SITZEN: FLBewerbung = FLBewerbungSchema.parse({
  ...OFFEN,
  kontakte: { ...OFFEN.kontakte, stellvertretung: person("Bernd", null), trainer: person("Clara", null) },
  bestaetigungen: { ansprechperson: SITZ, stellvertretung: SITZ, trainer: { ...SITZ, abgelehnt_am: "2026-09-03" } },
} satisfies FLBewerbung);

const typeReason = (user: UserEvent) => user.type(screen.getByRole("textbox", { name: "Grund für die Absage" }), "Kein Platz.");

const typeCorrection = async (user: UserEvent) => {
  await user.click(screen.getByRole("button", { name: "E-Mail-Adresse von Bernd Meier korrigieren" }));
  await user.clear(screen.getByRole("textbox", { name: "Neue E-Mail-Adresse" }));
  await user.type(screen.getByRole("textbox", { name: "Neue E-Mail-Adresse" }), "bernd.meier@schule.example");
};

const typeReseat = async (user: UserEvent) => {
  await user.click(screen.getByRole("button", { name: "Trainer neu besetzen" }));
  await user.type(screen.getByRole("textbox", { name: "Vorname" }), "Doreen");
  await user.type(screen.getByRole("textbox", { name: "Nachname" }), "Ostwald");
  await user.type(screen.getByRole("textbox", { name: "E-Mail" }), "doreen@schule.example");
  await user.type(screen.getByRole("textbox", { name: "Telefon" }), "069 7654321");
};

/** A press on this page, what it needs before it can be pressed, and the typing in another panel its write would drop. */
type PagePress = {
  ready?: (user: UserEvent) => Promise<void>;
  other: (user: UserEvent) => Promise<void>;
  press: string;
  armed?: string;
  write: string;
};

const PAGE_PRESSES: Record<string, PagePress> = {
  "the decline, beside a correction typed in the strip": {
    ready: typeReason,
    other: typeCorrection,
    press: "Bewerbung ablehnen",
    armed: "Ja, Absage verbindlich verschicken",
    write: "ablehnenBewerbungAction",
  },
  "the re-send, beside a typed reason": {
    other: typeReason,
    press: "Link erneut senden an Stellvertretung",
    write: "einwilligungErneutSendenAction",
  },
  "the re-send, beside another seat's box holding typing": {
    other: typeReseat,
    press: "Link erneut senden an Stellvertretung",
    write: "einwilligungErneutSendenAction",
  },
  "the correction, beside a typed reason": {
    ready: typeCorrection,
    other: typeReason,
    press: "Korrigieren und Link senden",
    write: "kontaktEmailKorrigierenAction",
  },
  "the reseat, beside a typed reason": {
    ready: typeReseat,
    other: typeReason,
    press: "Neu besetzen und Link senden",
    write: "besetzeKontaktSitzAction",
  },
};

const settled = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

describe("a press on the application page beside another panel's typing", () => {
  for (const [name, move] of Object.entries(PAGE_PRESSES)) {
    /* Every write here re-keys the page on the moved application, so a press beside another panel's typing
       throws that typing away unasked. The press writes where nothing else is typed, so the refusal below is
       the other panel's alone. */
    it(`${name} refuses, naming the typing's loss, and writes nothing`, async () => {
      const user = userEvent.setup();

      const clean = renderPage(MIT_OFFENEN_SITZEN);
      await move.ready?.(user);
      calls.length = 0;
      if (move.armed === undefined) await user.click(screen.getByRole("button", { name: move.press }));
      else await pressTwice(user, { resting: move.press, armed: move.armed });
      await settled();
      assert.deepEqual(
        calls.map((call) => call.action),
        [move.write],
        "the press over an otherwise clean page did not write, so the refusal below judges nothing",
      );
      clean.unmount();

      renderPage(MIT_OFFENEN_SITZEN);
      await move.ready?.(user);
      await move.other(user);
      calls.length = 0;
      raised.length = 0;
      await user.click(screen.getByRole("button", { name: move.press }));
      await settled();

      assert.deepEqual(calls, [], "the press wrote over another panel's typing");
      assert.deepEqual(
        raised.map((toast) => [toast.variant, toast.title, toast.description]),
        [["warning", "Erst speichern", DRAFT_DISCARDED]],
      );
    });
  }
});
