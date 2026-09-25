import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { ZUSTELLUNG_CHIP } from "@/features/bewerbungen/zustellung.ts";
import { SCHIEDSRICHTER_KORREKTUR_HINWEIS } from "@/features/schiedsrichter/constants.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";
import { nextRouter, recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { FLSchiedsrichterBestaetigung } from "@/features/schiedsrichter/schemas.ts";
import type { FLEinwilligung } from "@/features/spieler/schemas.ts";

/* Every write hangs until a case answers it: a real action needs a session and a backend. */
const { calls, answerWith } = doubleActions({
  modules: ["/src/features/schiedsrichter/actions.ts"],
  answer: () => new Promise<never>(() => undefined),
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { FormBestaetigungSection } = await import("./FormBestaetigungSection.tsx");

const SCHIEDSRICHTER_ID = "6890a1b2c3d4e5f607800001";

const BLOCK: FLSchiedsrichterBestaetigung = {
  verschickt_am: "2026-09-21",
  erinnert_am: null,
  frist: "2026-10-05",
  zustellung: null,
};

const BESTAETIGT: FLEinwilligung = {
  umfang: "kader_oeffentlich",
  erteilt_von: "volljaehrig",
  datum: "2026-09-22",
  bestaetigt_am: "2026-09-22",
  text_version: "2026-09-schiedsrichterseite",
  medien: false,
};

type Props = Parameters<typeof FormBestaetigungSection>[0];

const PROPS: Props = {
  schiedsrichterId: SCHIEDSRICHTER_ID,
  hatAdresse: true,
  isRetired: false,
  bestaetigung: null,
  einwilligung: null,
  geburtsdatum: null,
  isDirty: false,
};

const panel = (overrides: Partial<Props> = {}) => underNext(h(FormBestaetigungSection, { ...PROPS, ...overrides }), { router: nextRouter() });

const words = (overrides: Partial<Props> = {}): string =>
  textOf(renderTree(panel(overrides)), " ")
    .replace(/\s+/g, " ")
    .trim();

afterEach(() => {
  calls.length = 0;
  toasts.length = 0;
  answerWith(() => new Promise<never>(() => undefined));
});

describe("what the editor shows about a referee's own confirmation", () => {
  /* The record is the person's own answer, so a control here would offer an administrator a write
     that is not theirs. */
  it("renders a confirmed record as facts with no control that could change it", () => {
    const { container } = render(panel({ bestaetigung: BLOCK, einwilligung: BESTAETIGT, geburtsdatum: "1990-01-01" }));

    assert.equal(container.querySelectorAll("input, select, textarea").length, 0, "the record is offered as an input");
    assert.deepEqual(
      // The one press this panel carries mails a link, and on a confirmed referee it is closed, so
      // the refusal overlay names it a second time; nothing here writes the record.
      screen.getAllByRole("button").map((control) => control.getAttribute("aria-label") ?? control.textContent),
      ["Hinweis zur Bestätigung", "Link erneut senden", "Link erneut senden"],
    );
  });

  it("names every stored answer the confirmation wrote", () => {
    const shown = words({ bestaetigung: BLOCK, einwilligung: BESTAETIGT, geburtsdatum: "1990-01-01" });

    assert.match(shown, /Name im Spielplan/, "the publication answer is not shown");
    assert.match(shown, /Nicht zugesagt/, "the media answer is not shown");
    assert.match(shown, /2026-09-schiedsrichterseite/, "the stamped wording is not named");
    assert.match(shown, /01\.01\.1990/, "the birthdate the same press wrote is not shown");
  });

  /* A live row with no confirmed record is withheld, which is the fact an administrator reading an empty
     panel would otherwise have to infer from an absence. */
  it("says what an outstanding confirmation costs, rather than leaving the panel empty", () => {
    assert.match(words({ bestaetigung: BLOCK }), /noch nicht bestätigt/);
    assert.match(words({ bestaetigung: BLOCK }), /„anonym“/);
  });

  it("shows the link's own dates and says a referee is never reminded", () => {
    const shown = words({ bestaetigung: BLOCK });

    assert.match(shown, /21\.09\.2026/, "the day the link went is not shown");
    assert.match(shown, /05\.10\.2026/, "the day it stops working is not shown");
    assert.match(shown, /Keine Erinnerung/, "an absent reminder reads as a missing day");
  });

  /* The delivery register's one word for a blocked address: a second coined here
     would name one state twice. */
  it("wears the delivery register's own chip where a message was refused", () => {
    const shown = words({
      bestaetigung: { ...BLOCK, zustellung: { nachricht_id: "m1", stand: "unterdrueckt", grund: "suppressed", am: "2026-09-21T10:00:00Z" } },
    });

    assert.ok(shown.includes(ZUSTELLUNG_CHIP.unterdrueckt?.label ?? ""), "the blocked delivery is not named");
  });

  it("carries no chip while nothing about the delivery needs acting on", () => {
    const shown = words({
      bestaetigung: { ...BLOCK, zustellung: { nachricht_id: "m1", stand: "zugestellt", grund: null, am: "2026-09-21T10:00:00Z" } },
    });

    assert.match(shown, /Nichts zu melden/);
  });

  /* The save bar mints and mails on its own where the address of an outstanding referee moves, so
     an administrator would otherwise look for a press that does it. */
  it("says that correcting an outstanding referee's address sends a new link by itself", () => {
    assert.ok(words({ bestaetigung: BLOCK }).includes(SCHIEDSRICHTER_KORREKTUR_HINWEIS.replace(/\s+/g, " ")));
  });

  it("drops that sentence once the person has confirmed", () => {
    const shown = words({ bestaetigung: BLOCK, einwilligung: BESTAETIGT });

    assert.ok(!shown.includes(SCHIEDSRICHTER_KORREKTUR_HINWEIS.replace(/\s+/g, " ")), "a confirmed referee is promised an automatic re-send");
  });
});

describe("what the panel says about a link nobody answered", () => {
  /* A date an administrator reads as a deadline says nothing once it is past, and the one thing to
     do about it is the control in this same panel. */
  it("marks a deadline that has gone by", () => {
    const shown = words({ bestaetigung: { ...BLOCK, frist: "2020-01-01" } });

    assert.match(shown, /abgelaufen/);
  });

  it("marks nothing while the link still works", () => {
    assert.doesNotMatch(words({ bestaetigung: { ...BLOCK, frist: "2999-01-01" } }), /abgelaufen/);
  });

  /* A confirmed referee needs no live link, so a lapsed deadline beside their answer would report a
     state that costs them nothing. */
  it("marks no lapse on a referee who already answered", () => {
    const shown = words({ bestaetigung: { ...BLOCK, frist: "2020-01-01" }, einwilligung: BESTAETIGT });

    assert.doesNotMatch(shown, /abgelaufen/);
  });
});

describe("the control that sends the link", () => {
  it("offers the first send under its own words rather than as a repeat", () => {
    render(panel());

    assert.ok(screen.getByRole("button", { name: "Bestätigungslink senden" }));
  });

  it("closes on a row with no address, naming what to repair", () => {
    render(panel({ hatAdresse: false }));

    closedControl("Bestätigungslink senden", /Trage zuerst eine E-Mail-Adresse ein/);
  });

  /* A retired row takes no booking, so what the link would collect is consent for a role nobody can
     give this person — the first thing to repair, ahead of the address it also lacks. */
  it("closes on a retired row ahead of the missing address", () => {
    render(panel({ isRetired: true, hatAdresse: false }));

    closedControl("Bestätigungslink senden", /Reaktiviere den Eintrag/);
  });

  /* The one press that leaves this panel: a retired row this test drives through the control rather
     than the disabled attribute, which says nothing about what a screen reader is told. */
  it("keeps the retired row's press closed", () => {
    render(panel({ isRetired: true, bestaetigung: BLOCK }));

    closedControl("Link erneut senden", /Reaktiviere den Eintrag/);
  });

  /* The endpoint refuses a second link for a person who has confirmed, there being no page left for
     them to open: closed here, the administrator is told before the round trip. */
  it("closes on a referee who already answered", () => {
    render(panel({ bestaetigung: BLOCK, einwilligung: BESTAETIGT }));

    closedControl("Link erneut senden", /schon bestätigt/);
  });

  it("sends the referee's id and nothing else", async () => {
    answerWith(() => Promise.resolve({ success: true, message: "gesendet" }));
    render(panel({ bestaetigung: BLOCK }));

    await userEvent.setup().click(screen.getByRole("button", { name: "Link erneut senden" }));

    assert.deepEqual(calls, [{ action: "einladeSchiedsrichterAction", payload: { id: SCHIEDSRICHTER_ID } }]);
  });

  it("reports a refusal rather than leaving the press to look like it worked", async () => {
    answerWith(() => Promise.resolve({ success: false, error: "Diese Person ist stillgelegt" }));
    render(panel({ bestaetigung: BLOCK }));

    await userEvent.setup().click(screen.getByRole("button", { name: "Link erneut senden" }));

    assert.deepEqual(
      toasts.map((raised) => [raised.variant, raised.title]),
      [["danger", "Bestätigungslink nicht gesendet"]],
    );
  });

  /* Thrown in transport or answered so by the API, nobody can tell whether the link went out: one
     toast of unknown outcome either way. */
  const ANSWERED = "Ob die Änderung gespeichert wurde, ist unklar. Lade die Seite neu und prüfe, ob sie da ist.";
  const unclear: Record<string, { answer: () => Promise<unknown>; repair: string }> = {
    // No answer came back, so the control's own repair names the connection.
    thrown: {
      answer: () => Promise.reject(new TypeError("Failed to fetch")),
      repair: "Prüfe die Verbindung und sende den Link noch einmal. Ein neuer Link ersetzt einen, der schon rausging.",
    },
    answered: { answer: () => Promise.resolve({ success: false, error: ANSWERED, outcome: "unknown" }), repair: ANSWERED },
  };
  for (const [arm, { answer, repair }] of Object.entries(unclear)) {
    it(`says a send nobody can tell landed is unclear, ${arm}`, async () => {
      answerWith(answer);
      render(panel({ bestaetigung: BLOCK }));

      await userEvent.setup().click(screen.getByRole("button", { name: "Link erneut senden" }));

      assert.deepEqual(
        toasts.map((raised) => [raised.title, raised.description, raised.options?.outcome]),
        [["Bestätigungslink nicht gesendet", repair, "unknown"]],
      );
    });
  }

  /* A send that answered comes back with the action's own refresh where a write landed, so the panel
     reads the page again only where nobody can tell whether one did. */
  it("reads the page again only after a send nobody can tell landed", async () => {
    const answers: Record<string, () => Promise<unknown>> = {
      sent: () => Promise.resolve({ success: true, message: "gesendet" }),
      refused: () => Promise.resolve({ success: false, error: "Diese Person ist stillgelegt" }),
      thrown: unclear.thrown?.answer ?? assert.fail("no thrown arm"),
      answered: unclear.answered?.answer ?? assert.fail("no answered arm"),
    };
    const refreshes: Record<string, number> = {};

    for (const [arm, answer] of Object.entries(answers)) {
      const { router, seen } = recordingRouter();
      answerWith(answer);
      const { unmount } = render(underNext(h(FormBestaetigungSection, { ...PROPS, bestaetigung: BLOCK }), { router }));

      await userEvent.setup().click(screen.getByRole("button", { name: "Link erneut senden" }));
      refreshes[arm] = seen.refresh;
      unmount();
    }

    assert.deepEqual(refreshes, { sent: 0, refused: 0, thrown: 1, answered: 0 });
  });
});
