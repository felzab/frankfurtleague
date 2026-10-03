import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { answersInFlight } from "@/shared/testing/answersInFlight.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";

import type { ActionFailure } from "@/shared/types/types.ts";
import type { EinwilligungAntwort, EinwilligungWahl, EinwilligungWorte } from "./EinwilligungForm.tsx";

const { raised } = doubleToasts();
const { track, answered } = answersInFlight();

const { EinwilligungForm, WAHL_GESPEICHERT, WAHL_NICHT_GESPEICHERT } = await import("./EinwilligungForm.tsx");

/** Words written for the suite rather than read from the registry: the component renders whatever it is handed. */
const WORTE: EinwilligungWorte = {
  textVersion: "konto-test-1",
  umfang: {
    frage: "Was darf von Deinem Namen auf der Website stehen?",
    optionen: { kader_oeffentlich: "Vorname und Initiale", intern: "Nur Nummer und Position" },
    absatz: "Was auf der Website steht, kannst Du hier umstellen.",
  },
  medien: {
    schalter: "Die Liga darf Fotos, Videos und Interviews von mir veröffentlichen.",
    absatz: "Fotos, Videos und Interviews kannst Du hier zurücknehmen.",
  },
};

/** A contact seat's record: a media choice and no publication choice. */
const SITZ_WORTE: EinwilligungWorte = { textVersion: WORTE.textVersion, medien: WORTE.medien };

const GESPEICHERT: EinwilligungWahl = { umfang: "kader_oeffentlich", medien: false };

/** Every press the form sent, in order. */
const sent: EinwilligungAntwort[] = [];

/** What the next press is answered with. */
let answer: { success: true } | ActionFailure = { success: true };

const speichereAction = (antwort: EinwilligungAntwort): Promise<{ success: true } | ActionFailure> => {
  sent.push(antwort);
  return track("speichereAction", Promise.resolve(answer));
};

beforeEach(() => {
  sent.length = 0;
  raised.length = 0;
  answer = { success: true };
});

function renderForm({
  worte = WORTE,
  gespeichert = GESPEICHERT,
  medienAngeboten = true,
}: { worte?: EinwilligungWorte; gespeichert?: EinwilligungWahl; medienAngeboten?: boolean } = {}) {
  const { router } = recordingRouter();
  const user = userEvent.setup();
  const mounted = render(underNext(h(EinwilligungForm, { worte, gespeichert, medienAngeboten, speichereAction }), { router }));

  return { ...mounted, user };
}

/** The element an `aria-describedby` names, which has to be one element and not a list. */
function describedBy(control: Element): HTMLElement {
  const ids = (control.getAttribute("aria-describedby") ?? "").split(" ").filter((id) => id !== "");
  assert.equal(ids.length, 1, `the control is described by ${String(ids.length)} elements`);
  return document.getElementById(ids[0] ?? "") ?? assert.fail("the description names no element on the page");
}

/** Whether `first` comes before `second` in the document, which is the order a screen reader and the tab key read. */
const precedes = (first: Node, second: Node): boolean => (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe("the consent control a sixteen-year-old reads before pressing", () => {
  /* The likelier defect with two controls than with one is the two being labelled alike, so each name is
     compared to its own words and to the other's. */
  it("names each control by its own words, and the two names differ", () => {
    renderForm();

    const gruppe = screen.getByRole("radiogroup");
    const schalter = screen.getByRole("switch");

    assert.ok(screen.getByRole("radiogroup", { name: WORTE.umfang?.frage }) === gruppe, "the chips are not named by their question");
    assert.ok(screen.getByRole("switch", { name: WORTE.medien.schalter }) === schalter, "the switch is not named by its own words");
    assert.notEqual(WORTE.umfang?.frage, WORTE.medien.schalter);
    for (const [wert, label] of Object.entries(WORTE.umfang?.optionen ?? {})) {
      assert.ok(screen.getByRole("radio", { name: label }), `the chip for ${wert} is not named by its own words`);
    }
  });

  it("describes each control by the paragraph that governs it, as an element", () => {
    renderForm();

    const umfangAbsatz = describedBy(screen.getByRole("radiogroup"));
    const medienAbsatz = describedBy(screen.getByRole("switch"));

    assert.equal(umfangAbsatz.tagName, "P");
    assert.equal(umfangAbsatz.textContent, WORTE.umfang?.absatz);
    assert.equal(medienAbsatz.tagName, "P");
    assert.equal(medienAbsatz.textContent, WORTE.medien.absatz);
  });

  /* Operability itself is React Aria's; what is this component's is the order the page reads in and that
     nothing jumps the queue. */
  it("reaches the chips and then the switch from the keyboard, in the order the page reads, with no positive tabindex", async () => {
    const { user, container } = renderForm();

    const gruppe = screen.getByRole("radiogroup");
    const schalter = screen.getByRole("switch");
    assert.ok(precedes(gruppe, describedBy(gruppe)), "the publication paragraph stands above its chips");
    assert.ok(precedes(describedBy(gruppe), schalter), "the switch stands above the publication paragraph");
    assert.ok(precedes(schalter, describedBy(schalter)), "the media paragraph stands above its switch");
    assert.deepEqual(
      [...container.querySelectorAll("[tabindex]")].filter((node) => Number(node.getAttribute("tabindex")) > 0).map((node) => node.outerHTML),
      [],
      "an element jumps the reading order",
    );

    await user.tab();
    assert.ok(document.activeElement === screen.getByRole("radio", { name: "Vorname und Initiale" }), "the first stop is not the chosen chip");
    await user.tab();
    assert.ok(document.activeElement === schalter, "the second stop is not the switch");

    await user.keyboard(" ");
    await act(answered);
    assert.deepEqual(sent, [{ umfang: "kader_oeffentlich", medien: true, text_version: WORTE.textVersion }]);
  });
});

describe("what a press sends", () => {
  /* The pair that goes red the day the payload is built from the one control pressed: moving one choice
     would reset the other. */
  it("moves the publication choice and sends the media choice as it stood", async () => {
    const { user } = renderForm({ gespeichert: { umfang: "kader_oeffentlich", medien: true } });

    await user.click(screen.getByRole("radio", { name: "Nur Nummer und Position" }));
    await act(answered);

    assert.deepEqual(sent, [{ umfang: "intern", medien: true, text_version: WORTE.textVersion }]);
    assert.deepEqual(
      raised.map(({ variant, title }) => [variant, title]),
      [["success", WAHL_GESPEICHERT]],
    );
  });

  it("moves the media choice and sends the publication choice as it stood", async () => {
    const { user } = renderForm({ gespeichert: { umfang: "intern", medien: false } });

    await user.click(screen.getByRole("switch"));
    await act(answered);

    assert.deepEqual(sent, [{ umfang: "intern", medien: true, text_version: WORTE.textVersion }]);
  });

  it("sends nothing for a press on the chip already chosen", async () => {
    const { user } = renderForm();

    await user.click(screen.getByRole("radio", { name: "Vorname und Initiale" }));
    await act(answered);

    assert.deepEqual(sent, []);
  });

  /* The page shows what the league holds: a refused press leaves the stored choice standing, and the toast
     carries the action's own sentence. */
  it("shows a refused press's sentence and goes back to the stored choice", async () => {
    answer = { success: false, error: "Diese Seite ist nicht mehr aktuell. Lade sie neu und wähle erneut." };
    const { user } = renderForm();

    await user.click(screen.getByRole("radio", { name: "Nur Nummer und Position" }));
    await act(answered);

    assert.deepEqual(
      raised.map(({ variant, title, description }) => [variant, title, description]),
      [["danger", WAHL_NICHT_GESPEICHERT, answer.success ? null : answer.error]],
    );
    assert.equal(screen.getByRole("radio", { name: "Vorname und Initiale" }).getAttribute("aria-checked"), "true");
  });

  it("sends a contact seat's media choice with no publication choice at all", async () => {
    const { user } = renderForm({ worte: SITZ_WORTE, gespeichert: { medien: false } });

    assert.equal(screen.queryAllByRole("radiogroup").length, 0, "a contact seat is offered a publication choice it does not hold");
    await user.click(screen.getByRole("switch", { name: SITZ_WORTE.medien.schalter }));
    await act(answered);

    assert.deepEqual(sent, [{ medien: true, text_version: SITZ_WORTE.textVersion }]);
  });
});

describe("when the media switch is offered", () => {
  it("leaves the switch out below the age the backend names, and keeps the paragraph", () => {
    renderForm({ medienAngeboten: false });

    assert.equal(screen.queryAllByRole("switch").length, 0, "a media consent is offered below the age the backend names");
    assert.ok(screen.getByText(WORTE.medien.absatz as string));
  });

  /* A withdrawal stands open on every record holding a consent, whatever the age verdict: a consent the
     page could not take back would be one the person cannot withdraw. */
  it("offers the switch while it is on, so the consent can be withdrawn", async () => {
    const { user } = renderForm({ gespeichert: { umfang: "intern", medien: true }, medienAngeboten: false });

    await user.click(screen.getByRole("switch", { name: WORTE.medien.schalter }));
    await act(answered);

    assert.deepEqual(sent, [{ umfang: "intern", medien: false, text_version: WORTE.textVersion }]);
  });
});
