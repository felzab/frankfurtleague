import "@/shared/testing/dom.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it, mock } from "node:test";

import { act, createElement } from "react";

import { cleanup, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { APIBadStatusError } from "@/core/errors.ts";
import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";
import { doubleActionRequest, doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl } from "@/shared/testing/closedControl.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { pageBody } from "@/shared/testing/pageHarness.ts";

import type { StepUp } from "@/shared/components/ui/stepUp.ts";
import type { UserEvent } from "@testing-library/user-event";
import type { TestContext } from "node:test";
import type { FLErasureAnsichtResponse } from "./schemas.ts";

/* An administrator's session, which the page's own check reads: it renders for nobody else
   (`fl_frontend/src/app/bereich/admin/turnedAway.test.ts`). */
doubleActionRequest();
const { calls, answerWith, answered } = doubleActions({ modules: ["/src/features/funktionen/actions.ts"] });
const { raised } = doubleToasts();

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: AdminLoeschungPage } = await import("@/app/bereich/admin/loeschung/page.tsx");
const { FLErasureAnsichtResponseSchema } = await import("./schemas.ts");
const { mapAbmeldungRefusal, mapErasureRefusal } = await import("./refusals.ts");
const { STEP_UP_LABEL, StepUpContext } = await import("@/shared/components/ui/stepUp.ts");

/** A rule's refusal as the client raises one, for the mappers' own words. */
const refused = (serverErrorCode: string): APIBadStatusError =>
  new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/identitaet/erasure",
    statusCode: 403,
    serverErrorCode,
    endpoint: "/identitaet/erasure",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

const ID = "68c1f0a2b3c4d5e6f7a8b9c0";
const PUPIL_ID = "68c1f0a2b3c4d5e6f7a8b9c1";
const ADRESSE = "Ada.Byron@Example.org";
const ANDERE_ADRESSE = "grace.hopper@example.org";
const ANLASS = "E-Mail vom 12.10.2026, Betreff Löschung meiner Daten";
const ARMED = "Ja, Person endgültig löschen";
const BESTAETIGUNG = /^Gib zur Bestätigung die Adresse/;

const NICHTS_GESPEICHERT = {
  spieler: [],
  schiedsrichter: [],
  sitze: [],
  bewerbungen: [],
  registrierungen: [],
  adresswechsel: [],
  spieler_adresswechsel: [],
  verwaltung: null,
};

/** One record of every kind the reveal names, typed against the mirror: a kind added there fails to compile here first. */
const EIN_EINTRAG_JE_ART = {
  spieler: [{ spieler_id: ID, vorname: "Lena", nachname: "Meier", kader: [{ saison_id: "2026", team_id: ID, team_name: "SG Alpha" }] }],
  schiedsrichter: [{ schiedsrichter_id: ID, name: "Pia Kraft" }],
  sitze: [{ saison_id: "2026", team_id: ID, team_name: "SG Alpha", rolle: "trainer", vorname: "Grace", nachname: "Meier" }],
  bewerbungen: [{ bewerbung_id: ID, saison_id: "2027", rolle: "ansprechperson", vorname: "Grace", nachname: "Meier" }],
  registrierungen: [{ registrierung_id: ID, saison_id: "2026", team_id: ID, team_name: "SG Alpha", vorname: "Lena", nachname: "Meier" }],
  adresswechsel: [{ schiedsrichter_id: ID }],
  spieler_adresswechsel: [{ spieler_id: PUPIL_ID }],
  verwaltung: "owner",
} satisfies Omit<FLErasureAnsichtResponse, "acknowledged">;

/** The lines every reveal ends on, whatever the read found. */
const IMMER = [
  "Das Konto der Adresse mit Passkeys und Anmeldungen, falls eines besteht",
  "Die Adresse im Änderungsprotokoll und als Urheberin von Sperren, Einladungen, Entscheidungen und Zugängen",
];

/** The kinds the mirror declares, read off its own keys, so the answer below carries every one there is. */
const ARTEN = Object.keys(FLErasureAnsichtResponseSchema.shape).filter((key) => key !== "acknowledged");

/** What each action answers, by its name, until a case names other answers. */
let answers: Record<string, unknown> = {};
const answering = (next: Record<string, unknown>): void => {
  answers = {
    readErasureAnsichtAction: { success: true, ansicht: NICHTS_GESPEICHERT },
    eraseAufAnfrageAction: { success: true, konto: "geloescht", gespeichert: true, message: "Alles ist gelöscht." },
    endAnmeldungenAction: { success: true, konto: true, message: "Jede Anmeldung der Adresse ist beendet." },
    ...next,
  };
  answerWith(() => Promise.resolve(answers[calls.at(-1)?.action ?? ""]));
};

afterEach(() => {
  cleanup();
  calls.length = 0;
  raised.length = 0;
});

/** The page as its route renders it for an administrator, under a router recording every navigation. */
async function renderPage(next: Record<string, unknown> = {}, search = "", stepUp?: StepUp) {
  answering(next);
  const { router, seen } = recordingRouter();
  const body = await pageBody(AdminLoeschungPage, { params: Promise.resolve({}), searchParams: Promise.resolve({}) });
  render(underNext(createElement(StepUpContext.Provider, { value: stepUp }, body), { router, pathname: "/bereich/admin/loeschung", search }));

  return { seen, user: userEvent.setup() };
}

/** One of the page's two panels, by its heading. */
const panel = (title: string): HTMLElement => {
  const section = screen.getByRole("heading", { name: title }).closest("section");
  assert.ok(section instanceof HTMLElement, `no panel headed „${title}“`);
  return section;
};

/** Open where exactly one enabled control carries the name: a closed press is disabled, its overlay named alike. */
const offen = (name: string): boolean =>
  screen
    .queryAllByRole("button", { name })
    .filter(
      (button) => button.closest("[inert]") === null && !button.hasAttribute("disabled") && button.getAttribute("aria-disabled") !== "true",
    ).length === 1;

const sent = (action: string) => calls.filter((call) => call.action === action);

/** The reveal's list, found under the heading its neighbours' reveals share the form of. */
const liste = (): HTMLElement => {
  const block = within(screen.getByRole("alert")).getByRole("heading", { name: "Was dabei gelöscht wird" }).parentElement;
  assert.ok(block instanceof HTMLElement, "the reveal's heading heads no block");
  return within(block).getByRole("list");
};

/** The erasure panel's two boxes, typed. */
async function typeRequest(user: UserEvent, email = ADRESSE, anlass = ANLASS): Promise<void> {
  const erasure = panel("Person löschen");
  await user.type(within(erasure).getByRole("textbox", { name: "E-Mail" }), email);
  await user.type(within(erasure).getByRole("textbox", { name: "Anlass" }), anlass);
}

/** Every read the case makes held open until the case answers it, by the order the reads were made in. */
function holdReads(): { answer: (read: number, value: unknown) => void } {
  const held: ((value: unknown) => void)[] = [];
  answerWith(() => new Promise((resolve) => void held.push(resolve)));

  return {
    answer: (read, value) => {
      const release = held[read];
      assert.ok(release !== undefined, `no read ${String(read)} was made`);
      release(value);
    },
  };
}

/** The arming press and the read it makes, answered. */
async function arm(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Person löschen" }));
  await act(answered);
  await screen.findByRole("button", { name: "Abbrechen" });
}

describe("the erasure's press", () => {
  it("stays closed until the Anlass and the retyped address are in, and the address in other capitals opens it", async () => {
    const { user } = await renderPage();
    const erasure = panel("Person löschen");

    assert.ok(!offen("Person löschen"), "the press opened over empty boxes");
    await user.type(within(erasure).getByRole("textbox", { name: "E-Mail" }), ADRESSE);
    assert.ok(!offen("Person löschen"), "the press opened with no Anlass");
    await user.type(within(erasure).getByRole("textbox", { name: "Anlass" }), ANLASS);
    assert.ok(offen("Person löschen"), "the press stayed closed over both boxes");

    await arm(user);
    assert.ok(!offen(ARMED), "the armed press opened before the address was retyped");
    await user.type(await screen.findByRole("textbox", { name: BESTAETIGUNG }), "ada.byron@EXAMPLE.ORG");
    assert.ok(offen(ARMED), "the address in other capitals left the press closed");
  });

  it("never sends where the retyped address is another", async () => {
    const { user } = await renderPage();
    await typeRequest(user);
    await arm(user);

    await user.type(await screen.findByRole("textbox", { name: BESTAETIGUNG }), "ada.lovelace@example.org");
    for (const control of screen.getAllByRole("button", { name: ARMED })) await user.click(control);

    assert.ok(!offen(ARMED), "a mismatch opened the press");
    assert.deepEqual(sent("eraseAufAnfrageAction"), [], "a mismatch sent the erasure");
  });

  /* The reveal and the confirmation are for the address read at arming: an edit of the box could otherwise
     confirm one person and erase another. */
  it("disarms on an edit of the address, so no reveal stands for an address the box has stopped holding", async () => {
    const { user } = await renderPage();
    await typeRequest(user);
    await arm(user);
    await user.type(await screen.findByRole("textbox", { name: BESTAETIGUNG }), ADRESSE);

    await user.type(within(panel("Person löschen")).getByRole("textbox", { name: "E-Mail" }), "x");

    assert.equal(screen.queryAllByRole("button", { name: "Abbrechen" }).length, 0, "the panel stayed armed over an edited address");
    assert.equal(within(panel("Person löschen")).queryAllByRole("alert").length, 0, "the reveal stands for the address before the edit");
    assert.deepEqual(sent("eraseAufAnfrageAction"), []);
  });

  /* Next sends one client's server actions one at a time, so the first arming's read answers while the second's
     waits behind it: that answer would otherwise ask for, and erase, an address the box has stopped holding. */
  it("never lets an earlier arming's answer stand for the address the box holds now", async () => {
    const { user } = await renderPage();
    const reads = holdReads();
    await typeRequest(user);

    await user.click(screen.getByRole("button", { name: "Person löschen" }));
    await user.click(await screen.findByRole("button", { name: "Abbrechen" }));
    const box = within(panel("Person löschen")).getByRole("textbox", { name: "E-Mail" });
    await user.clear(box);
    await user.type(box, ANDERE_ADRESSE);
    await user.click(screen.getByRole("button", { name: "Person löschen" }));

    await act(async () => reads.answer(0, { success: true, ansicht: NICHTS_GESPEICHERT }));
    assert.equal(screen.queryAllByRole("textbox", { name: BESTAETIGUNG }).length, 0, "the first arming's answer asks for its address");

    await act(async () => reads.answer(1, { success: true, ansicht: NICHTS_GESPEICHERT }));
    assert.ok(await screen.findByRole("textbox", { name: `Gib zur Bestätigung die Adresse „${ANDERE_ADRESSE}“ ein` }));
  });

  /* The list the press is confirmed over is the one read for this arming: one read for an earlier arming of the
     same address may name records the erasure no longer reaches. */
  it("holds the press over the latest arming's read, an earlier one for the same address answered first", async () => {
    const { user } = await renderPage();
    const reads = holdReads();
    await typeRequest(user);

    await user.click(screen.getByRole("button", { name: "Person löschen" }));
    await user.click(await screen.findByRole("button", { name: "Abbrechen" }));
    await user.click(screen.getByRole("button", { name: "Person löschen" }));

    await act(async () => reads.answer(0, { success: true, ansicht: NICHTS_GESPEICHERT }));
    assert.equal(screen.queryAllByRole("textbox", { name: BESTAETIGUNG }).length, 0, "an earlier arming's read stands for this one");

    await act(async () => reads.answer(1, { success: true, ansicht: NICHTS_GESPEICHERT }));
    assert.ok(await screen.findByRole("textbox", { name: BESTAETIGUNG }));
  });

  /* The erasure is sent for the address the reveal was read for, then both boxes empty for the next request; no
     address reaches a URL on the way (`docs/frontend/spec.md :: I686`). */
  it("erases the retyped address on the second press, empties both boxes and navigates nowhere", async (t) => {
    const { user, seen } = await renderPage();
    await typeRequest(user);

    t.mock.timers.enable({ apis: ["Date"] });
    await arm(user);
    await user.type(await screen.findByRole("textbox", { name: BESTAETIGUNG }), ADRESSE);
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: ARMED }));
    await act(answered);

    assert.deepEqual(sent("readErasureAnsichtAction"), [{ action: "readErasureAnsichtAction", payload: { email: ADRESSE } }]);
    assert.deepEqual(sent("eraseAufAnfrageAction"), [{ action: "eraseAufAnfrageAction", payload: { email: ADRESSE, anlass: ANLASS } }]);
    const erasure = panel("Person löschen");
    assert.equal((within(erasure).getByRole("textbox", { name: "E-Mail" }) as HTMLInputElement).value, "");
    assert.equal((within(erasure).getByRole("textbox", { name: "Anlass" }) as HTMLInputElement).value, "");
    assert.deepEqual(
      raised.map(({ title }) => title),
      ["Person gelöscht"],
    );
    assert.deepEqual([...seen.pushed, ...seen.replaced], [], "the press navigated");
    assert.equal(window.location.search, "", "an address reached the page's own URL");
  });
});

describe("the passkey the erasure's press asks for", () => {
  /* A session inside the step-up window and past the enrolment's: the API refuses the erasure of a grant holder's
     address from it, so the press asks first rather than meeting that refusal on every press. */
  const gate = () => {
    const asked: string[] = [];
    const stepUp: StepUp = {
      isStale: (_now, demand) => demand === "enrolment",
      confirm: () => {
        asked.push("prompt");
        return Promise.resolve(true);
      },
    };
    return { asked, stepUp };
  };

  /** Both presses, the confirming one taken by the label it wears once the read has landed. */
  const confirmed = async (verwaltung: "owner" | null, stepUp: StepUp, t: TestContext, armed: string) => {
    const { user } = await renderPage(
      { readErasureAnsichtAction: { success: true, ansicht: { ...NICHTS_GESPEICHERT, verwaltung } } },
      "",
      stepUp,
    );
    await typeRequest(user);
    t.mock.timers.enable({ apis: ["Date"] });
    await arm(user);
    await user.type(await screen.findByRole("textbox", { name: BESTAETIGUNG }), ADRESSE);
    t.mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: armed }));
    await act(answered);
  };

  /* The grant arrives with the reveal, after the arming: the press says it prompts before it does. */
  it("asks for it within the enrolment's window where the address holds a grant, saying so on the press", async (t) => {
    const { asked, stepUp } = gate();
    await confirmed("owner", stepUp, t, STEP_UP_LABEL);

    assert.deepEqual(asked, ["prompt"], "a grant holder's erasure went out without the passkey the API holds it to");
    assert.equal(sent("eraseAufAnfrageAction").length, 1);
  });

  it("asks for nothing more than the step-up's window where the address holds none", async (t) => {
    const { asked, stepUp } = gate();
    await confirmed(null, stepUp, t, ARMED);

    assert.deepEqual(asked, [], "an address holding no grant was held to the enrolment's window");
    assert.equal(sent("eraseAufAnfrageAction").length, 1);
  });
});

describe("the reveal the arming read answers", () => {
  /* Built off the mirror's keys: a kind the backend adds and the panel leaves unnamed is a line short. */
  it("names one line for every kind the read answers, and the account beside them", async () => {
    const ansicht = Object.fromEntries(ARTEN.map((art) => [art, EIN_EINTRAG_JE_ART[art as keyof typeof EIN_EINTRAG_JE_ART]]));
    const { user } = await renderPage({ readErasureAnsichtAction: { success: true, ansicht: ansicht } });
    await typeRequest(user);
    await arm(user);

    const zeilen = within(liste()).getAllByRole("listitem");
    assert.equal(zeilen.length, ARTEN.length + IMMER.length, "a kind the read answered has no line");
    assert.deepEqual(
      zeilen.slice(-IMMER.length).map((zeile) => zeile.textContent),
      IMMER,
    );
    // The referee's unplayed fixtures stand unassigned afterwards, the one thing the reveal asks the operator to act on.
    assert.match(screen.getByRole("alert").textContent, /Spiele ohne Ergebnis, .* brauchen danach eine neue Einteilung\./);
  });

  /* The log and the address's authorship are cleaned whatever the read found, so an operator answering the person
     must not read that nothing is held. */
  it("says an address holding no record holds no record, and still names the account, the log and the authorship", async () => {
    const { user } = await renderPage();
    await typeRequest(user);
    await arm(user);

    const reveal = screen.getByRole("alert").textContent;
    assert.match(reveal, /Unter dieser Adresse ist kein Eintrag gespeichert\./);
    assert.deepEqual(
      within(liste())
        .getAllByRole("listitem")
        .map((zeile) => zeile.textContent),
      IMMER,
      "an address holding no record reads as an erasure of an account alone",
    );
    assert.doesNotMatch(reveal, /nichts gespeichert|nur ein Konto/);
    assert.doesNotMatch(reveal, /Handlungsbedarf/, "an address holding no referee is told of fixtures to reassign");
  });

  /* A pending change names nobody, so its line opens the record it waits on, on the season the shell shows. */
  it("opens each pending address change's own record, a referee's and a pupil's, keeping the season", async () => {
    const ansicht = {
      ...NICHTS_GESPEICHERT,
      adresswechsel: EIN_EINTRAG_JE_ART.adresswechsel,
      spieler_adresswechsel: EIN_EINTRAG_JE_ART.spieler_adresswechsel,
    };
    const { user } = await renderPage({ readErasureAnsichtAction: { success: true, ansicht: ansicht } }, "saison_id=2026");
    await typeRequest(user);
    await arm(user);

    const ziele = within(screen.getByRole("alert"))
      .getAllByRole("link")
      .map((link) => link.getAttribute("href"));
    assert.deepEqual(ziele, [`/bereich/admin/schiedsrichter/${ID}?saison_id=2026`, `/bereich/admin/spieler/${PUPIL_ID}?saison_id=2026`]);
  });

  /* The operator's own address: the backend refuses the reveal too, so the page says so before anyone confirms, in
     the rule's sentence alone, a reveal the rule refused having loaded rather than failed to. */
  it("says the operator's own address is not erased here and never opens the confirmation", async () => {
    const eigene = mapErasureRefusal(refused("REQ-PURGE-003"))?.error ?? "REQ-PURGE-003 unworded";
    const { user } = await renderPage({ readErasureAnsichtAction: { success: false, error: eigene } });
    await typeRequest(user);
    await arm(user);

    assert.ok(within(screen.getByRole("alert")).getByText(eigene), "the rule's refusal reads as a list that failed to load");
    closedControl(ARMED, eigene);
    assert.equal(screen.queryAllByRole("textbox", { name: BESTAETIGUNG }).length, 0, "a refused reveal offers the confirmation");
    for (const control of screen.getAllByRole("button", { name: ARMED })) await user.click(control);
    assert.ok(!offen(ARMED), "the press opened over a refused reveal");
    assert.deepEqual(sent("eraseAufAnfrageAction"), []);
  });
});

/**
 * A word standing for a person of one gender: the three record nouns bare, each but where it follows its feminine
 * form in a pair, and the third-person pronouns. Never „sein“, which the panel's verbs spell too.
 */
const MASKULIN =
  /(?<!(?:Spielerin|Schiedsrichterin|Inhaberin|Trainerin) oder (?:einem |der )?)\b(?:Spieler|Schiedsrichter|Inhaber|Trainer)\b|\b(?:er|ihn|ihm)\b/i;

describe("the words the page names a person in", () => {
  /* It reads before anybody knows whose data it is, and names pupils, referees and grant holders alike. */
  it("names nobody with a masculine word, at rest, armed over every kind, or in a refusal", async () => {
    const ansicht = Object.fromEntries(ARTEN.map((art) => [art, EIN_EINTRAG_JE_ART[art as keyof typeof EIN_EINTRAG_JE_ART]]));
    const { user } = await renderPage({ readErasureAnsichtAction: { success: true, ansicht: ansicht } });
    const ruhend = document.body.textContent;
    await typeRequest(user);
    await arm(user);
    const gerueckt = document.body.textContent;
    const verweigert = ["REQ-PURGE-003", "REQ-PURGE-005"].flatMap((code) =>
      [mapErasureRefusal, mapAbmeldungRefusal].map((mapper) => mapper(refused(code))?.error ?? `${code} unworded`),
    );

    for (const [stand, text] of [["at rest", ruhend], ["armed", gerueckt], ...verweigert.map((satz) => ["refused", satz] as const)] as const) {
      assert.doesNotMatch(text, MASKULIN, `${stand}: the page names a person with a masculine word`);
    }
    // The control: the reveal did name each kind, so the absence above was read over every word there is. The
    // squad row places its season as every other line does.
    assert.match(gerueckt, /Spielerin oder Spieler: Lena Meier, im Kader von SG Alpha, Saison 2026/);
  });
});

describe("the sign-out of one address", () => {
  it("stays closed until an address is typed, then ends that address's sessions on the second press", async () => {
    const { user } = await renderPage();
    const abmelden = panel("Überall abmelden");

    assert.ok(!offen("Überall abmelden"), "the press opened over an empty box");
    await user.type(within(abmelden).getByRole("textbox", { name: "E-Mail" }), ADRESSE);

    mock.timers.enable({ apis: ["Date"] });
    try {
      await user.click(screen.getByRole("button", { name: "Überall abmelden" }));
      await screen.findByRole("button", { name: "Abbrechen" });
      mock.timers.tick(DOUBLE_PRESS_MS);
      await user.click(screen.getByRole("button", { name: "Ja, überall abmelden" }));
      await act(answered);
    } finally {
      mock.timers.reset();
    }

    assert.deepEqual(sent("endAnmeldungenAction"), [{ action: "endAnmeldungenAction", payload: { email: ADRESSE } }]);
    assert.equal((within(abmelden).getByRole("textbox", { name: "E-Mail" }) as HTMLInputElement).value, "");
    assert.deepEqual(
      raised.map(({ title }) => title),
      ["Abgemeldet"],
    );
  });
});
