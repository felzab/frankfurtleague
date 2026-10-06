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
import type { EinwilligungAntwort, EinwilligungStand, EinwilligungWahl, EinwilligungWorte } from "./EinwilligungForm.tsx";

const { raised } = doubleToasts();
const { track, answered } = answersInFlight();

const { EinwilligungForm } = await import("./EinwilligungForm.tsx");
const { SEITE_VERALTET, WAHL_GESPEICHERT, WAHL_NICHT_GESPEICHERT } = await import("../../../einwilligung.ts");

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
  widerruf: "Bist Du nicht mehr dabei, kannst Du hier nur zurücknehmen.",
};

/** A contact seat's record: its contact scope a WhatsApp switch beside the media switch, and no publication choice. */
const SITZ_WORTE: EinwilligungWorte = {
  textVersion: WORTE.textVersion,
  whatsapp: {
    schalter: "Die Liga darf mich auch über WhatsApp erreichen.",
    absatz: "Über WhatsApp erreichen wir Dich nur, wenn Du es erlaubst.",
  },
  medien: WORTE.medien,
  widerruf: WORTE.widerruf,
};

/** A seat holding the narrower contact scope and no media consent. */
const SITZ_GESPEICHERT: EinwilligungWahl = { umfang: "kontaktdaten", medien: false };

const GESPEICHERT: EinwilligungWahl = { umfang: "kader_oeffentlich", medien: false };

/** The stand the page was served, which a press echoes. */
const STAND: EinwilligungStand = { umfang: "2026-09-01T10:00:00+02:00", medien: null };

/** The stand a landed press leaves, which the next press sends. */
const NEUER_STAND: EinwilligungStand = { umfang: "2026-09-01T10:00:00+02:00", medien: "2026-10-04T09:30:00+02:00" };

type Antwort = { success: true; nachweis_stand: EinwilligungStand } | ActionFailure;

/** Every press the form sent, in order. */
const sent: EinwilligungAntwort[] = [];

/** What the next press is answered with. */
let answer: Antwort = { success: true, nachweis_stand: NEUER_STAND };

/** Where set, the next answer waits until the case releases it. */
let held: Promise<void> | null = null;

const speichereAction = (antwort: EinwilligungAntwort): Promise<Antwort> => {
  sent.push(antwort);
  const given = answer;
  return track(
    "speichereAction",
    (held ?? Promise.resolve()).then(() => given),
  );
};

beforeEach(() => {
  sent.length = 0;
  raised.length = 0;
  answer = { success: true, nachweis_stand: NEUER_STAND };
  held = null;
});

function renderForm({
  worte = WORTE,
  gespeichert = GESPEICHERT,
  medienAngeboten = true,
  erteilbar = true,
}: { worte?: EinwilligungWorte; gespeichert?: EinwilligungWahl; medienAngeboten?: boolean; erteilbar?: boolean } = {}) {
  const { router } = recordingRouter();
  const user = userEvent.setup();
  const mounted = render(
    underNext(h(EinwilligungForm, { worte, gespeichert, nachweisStand: STAND, medienAngeboten, erteilbar, speichereAction }), { router }),
  );

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
    assert.deepEqual(sent, [{ umfang: "kader_oeffentlich", medien: true, text_version: WORTE.textVersion, nachweis_stand: STAND }]);
  });
});

describe("what a press sends", () => {
  /* The pair that goes red the day the payload is built from the one control pressed: moving one choice
     would reset the other. */
  it("moves the publication choice and sends the media choice as it stood", async () => {
    const { user } = renderForm({ gespeichert: { umfang: "kader_oeffentlich", medien: true } });

    await user.click(screen.getByRole("radio", { name: "Nur Nummer und Position" }));
    await act(answered);

    assert.deepEqual(sent, [{ umfang: "intern", medien: true, text_version: WORTE.textVersion, nachweis_stand: STAND }]);
    assert.deepEqual(
      raised.map(({ variant, title }) => [variant, title]),
      [["success", WAHL_GESPEICHERT]],
    );
  });

  it("moves the media choice and sends the publication choice as it stood", async () => {
    const { user } = renderForm({ gespeichert: { umfang: "intern", medien: false } });

    await user.click(screen.getByRole("switch"));
    await act(answered);

    assert.deepEqual(sent, [{ umfang: "intern", medien: true, text_version: WORTE.textVersion, nachweis_stand: STAND }]);
  });

  /* Sent before the first is answered, the second would carry a stand the first moves and be refused as
     a stale page; built from the record as read, it would send the first's landed media grant back off. */
  it("sends a second press after the first is answered, with the stand and the choice that answer left", async () => {
    let release: () => void = () => undefined;
    held = new Promise((resolve) => {
      release = resolve;
    });
    const { user } = renderForm({ gespeichert: { umfang: "intern", medien: false } });

    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("radio", { name: "Vorname und Initiale" }));
    assert.equal(sent.length, 1, "the second press went out before the first was answered");

    held = null;
    release();
    await act(answered);

    assert.deepEqual(sent, [
      { umfang: "intern", medien: true, text_version: WORTE.textVersion, nachweis_stand: STAND },
      { umfang: "kader_oeffentlich", medien: true, text_version: WORTE.textVersion, nachweis_stand: NEUER_STAND },
    ]);
  });

  /* A grant refused at the day's ceiling must not ride along on the press after it: the second press
     would turn from a lone change into a mixed one, and be refused for the grant it never asked for. */
  it("builds each press from the record held and its own change, never from a refused press's", async () => {
    let release: () => void = () => undefined;
    held = new Promise((resolve) => {
      release = resolve;
    });
    answer = { success: false, error: SEITE_VERALTET };
    const { user } = renderForm({ gespeichert: { umfang: "kader_oeffentlich", medien: false } });

    await user.click(screen.getByRole("switch"));
    await user.click(screen.getByRole("radio", { name: "Nur Nummer und Position" }));
    answer = { success: true, nachweis_stand: NEUER_STAND };
    held = null;
    release();
    await act(answered);

    assert.deepEqual(sent, [
      { umfang: "kader_oeffentlich", medien: true, text_version: WORTE.textVersion, nachweis_stand: STAND },
      { umfang: "intern", medien: false, text_version: WORTE.textVersion, nachweis_stand: STAND },
    ]);
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
    answer = { success: false, error: SEITE_VERALTET };
    const { user } = renderForm();

    await user.click(screen.getByRole("radio", { name: "Nur Nummer und Position" }));
    await act(answered);

    assert.deepEqual(
      raised.map(({ variant, title, description }) => [variant, title, description]),
      [["danger", WAHL_NICHT_GESPEICHERT, answer.success ? null : answer.error]],
    );
    assert.equal(screen.getByRole("radio", { name: "Vorname und Initiale" }).getAttribute("aria-checked"), "true");
  });

  /* A seat's scope is no publication choice: its WhatsApp switch moves the scope, and each press carries
     the other choice as it stood. */
  it("moves a contact seat's media choice and sends its contact scope as it stood, offering no publication choice", async () => {
    const { user } = renderForm({ worte: SITZ_WORTE, gespeichert: SITZ_GESPEICHERT });

    assert.equal(screen.queryAllByRole("radiogroup").length, 0, "a contact seat is offered a publication choice it does not hold");
    await user.click(screen.getByRole("switch", { name: SITZ_WORTE.medien.schalter }));
    await act(answered);

    assert.deepEqual(sent, [{ umfang: "kontaktdaten", medien: true, text_version: SITZ_WORTE.textVersion, nachweis_stand: STAND }]);
  });

  it("moves a contact seat's WhatsApp scope and sends its media choice as it stood", async () => {
    const { user } = renderForm({ worte: SITZ_WORTE, gespeichert: { umfang: "kontaktdaten", medien: true } });

    await user.click(screen.getByRole("switch", { name: SITZ_WORTE.whatsapp?.schalter }));
    await act(answered);

    assert.deepEqual(sent, [{ umfang: "kontaktdaten_whatsapp", medien: true, text_version: SITZ_WORTE.textVersion, nachweis_stand: STAND }]);
  });
});

/** Whether a control takes no press: React Aria marks a disabled switch's input either way. */
const geschlossen = (control: Element): boolean => control.hasAttribute("disabled") || control.getAttribute("aria-disabled") === "true";

describe("when the media switch is offered", () => {
  /* The paragraph beside it says the switch is off and cannot be turned on below the age, so the switch
     stands there, closed, rather than being left out from under its own words. */
  it("shows the switch closed below the age the backend names, described by its paragraph", () => {
    renderForm({ medienAngeboten: false });

    const schalter = screen.getByRole("switch", { name: WORTE.medien.schalter });
    assert.ok(geschlossen(schalter), "a media consent is offered below the age the backend names");
    assert.equal(describedBy(schalter).textContent, WORTE.medien.absatz);
  });

  /* A withdrawal stands open on every record holding a consent, whatever the age verdict: a consent the
     page could not take back would be one the person cannot withdraw. */
  it("offers the switch while it is on, so the consent can be withdrawn", async () => {
    const { user } = renderForm({ gespeichert: { umfang: "intern", medien: true }, medienAngeboten: false });

    await user.click(screen.getByRole("switch", { name: WORTE.medien.schalter }));
    await act(answered);

    assert.deepEqual(sent, [{ umfang: "intern", medien: false, text_version: WORTE.textVersion, nachweis_stand: STAND }]);
  });
});

/* A record granting no panel (a retired pupil or referee, a past season's seat) takes a withdrawal and
   never a grant, so the page offers no press the backend refuses. */
describe("on a record that takes a withdrawal alone", () => {
  it("closes the wider publication and says why on the chip", () => {
    renderForm({ gespeichert: { umfang: "intern", medien: false }, erteilbar: false });

    const chip = screen.getByRole("radio", { name: "Vorname und Initiale" });
    assert.ok(
      chip.hasAttribute("disabled") || chip.getAttribute("aria-disabled") === "true",
      "a grant is offered on a record granting no panel",
    );
    assert.equal(describedBy(chip).textContent, WORTE.widerruf);
  });

  it("keeps a wider publication the record holds withdrawable", async () => {
    const { user } = renderForm({ gespeichert: { umfang: "kader_oeffentlich", medien: false }, erteilbar: false });

    await user.click(screen.getByRole("radio", { name: "Nur Nummer und Position" }));
    await act(answered);

    assert.deepEqual(sent, [{ umfang: "intern", medien: false, text_version: WORTE.textVersion, nachweis_stand: STAND }]);
  });

  /* Where a person would look for a grant and finds none, the switch they can press says why. */
  it("reads the reason a record takes a withdrawal alone with the switch, after its paragraph", () => {
    const nurWiderruf = "Hier kannst Du nur widerrufen.";
    renderForm({
      worte: { ...SITZ_WORTE, nurWiderruf },
      gespeichert: { umfang: "kontaktdaten", medien: true },
      erteilbar: false,
      medienAngeboten: false,
    });

    const schalter = screen.getByRole("switch", { name: SITZ_WORTE.medien.schalter });
    const beschrieben = (schalter.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent);
    assert.deepEqual(beschrieben, [SITZ_WORTE.medien.absatz, nurWiderruf]);
  });

  it("closes an off media switch whatever the age allows, saying why, and keeps an on one withdrawable", async () => {
    const aus = renderForm({ gespeichert: { umfang: "intern", medien: false }, erteilbar: false });
    const zu = screen.getByRole("switch", { name: WORTE.medien.schalter });
    assert.ok(geschlossen(zu), "a grant is offered on a record granting no panel");
    assert.deepEqual(
      (zu.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent),
      [WORTE.medien.absatz, WORTE.widerruf],
    );
    aus.unmount();

    const { user } = renderForm({ gespeichert: { umfang: "intern", medien: true }, erteilbar: false });
    await user.click(screen.getByRole("switch", { name: WORTE.medien.schalter }));
    await act(answered);

    assert.deepEqual(sent, [{ umfang: "intern", medien: false, text_version: WORTE.textVersion, nachweis_stand: STAND }]);
  });
});

/* A seat's WhatsApp scope is a grant like the media consent: closed where the seat admits none unless
   the seat holds it, and then withdrawable. The two switches are told apart by their own names. */
describe("a contact seat's WhatsApp switch", () => {
  it("names the two switches by their own words, and the two names differ", () => {
    renderForm({ worte: SITZ_WORTE, gespeichert: SITZ_GESPEICHERT });

    const whatsapp = screen.getByRole("switch", { name: SITZ_WORTE.whatsapp?.schalter });
    const medien = screen.getByRole("switch", { name: SITZ_WORTE.medien.schalter });
    assert.ok(whatsapp !== medien, "one switch carries both names");
    assert.notEqual(SITZ_WORTE.whatsapp?.schalter, SITZ_WORTE.medien.schalter);
    assert.equal(describedBy(whatsapp).textContent, SITZ_WORTE.whatsapp?.absatz);
  });

  it("closes the WhatsApp grant on a seat admitting none, and keeps a held one withdrawable", async () => {
    const aus = renderForm({
      worte: { ...SITZ_WORTE, nurWiderruf: "Hier kannst Du nur zurücknehmen." },
      gespeichert: SITZ_GESPEICHERT,
      erteilbar: false,
    });
    assert.ok(
      geschlossen(screen.getByRole("switch", { name: SITZ_WORTE.whatsapp?.schalter })),
      "a WhatsApp grant is offered where none is admitted",
    );
    aus.unmount();

    const { user } = renderForm({ worte: SITZ_WORTE, gespeichert: { umfang: "kontaktdaten_whatsapp", medien: false }, erteilbar: false });
    await user.click(screen.getByRole("switch", { name: SITZ_WORTE.whatsapp?.schalter }));
    await act(answered);

    assert.deepEqual(sent, [{ umfang: "kontaktdaten", medien: false, text_version: SITZ_WORTE.textVersion, nachweis_stand: STAND }]);
  });
});
