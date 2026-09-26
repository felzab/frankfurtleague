import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";

import { createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { ZURUECKGEHALTEN } from "@/features/einladungen/meldungen.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { FLEinladungVersandVorschauZeile } from "@/features/einladungen/schemas.ts";

/** A write nobody has answered yet, which is how each action answers unless a case says otherwise. */
const running = (): Promise<never> => new Promise(() => undefined);

const { calls, answerWith } = doubleActions({ modules: ["/src/features/einladungen/actions.ts"], answer: running });

/** The payloads one action was sent, in the order the panel sent them. */
const sent = (action: string): unknown[] => calls.filter((call) => call.action === action).map((call) => call.payload);

const { raised } = doubleToasts();

const { FormEinladungVersandSection } = await import("./FormEinladungVersandSection.tsx");
const { UNKNOWN_REFUSAL } = await import("@/shared/utils/refusal.ts");
const { unansweredAction } = await import("@/shared/utils/actionError.ts");

/** Four characters, the width every schema in the tree holds a season id to. */
const SAISON_ID = "2627";

const ID = (letter: string): string => letter.repeat(24);

/**
 * **Every member of the reason set is here**, so a value the endpoint answers with and the panel has
 * no sentence for fails this fixture rather than rendering as nothing.
 */
const VORSCHAU: readonly FLEinladungVersandVorschauZeile[] = [
  {
    team_id: ID("a"),
    team_name: "Ernst-Reuter-Schule",
    empfaenger: [
      { rolle: "ansprechperson", vorname: "Erika", email: "erika@beispiel.de" },
      { rolle: "trainer", vorname: "Jonas", email: "jonas@beispiel.de" },
    ],
    uebersprungen: null,
    ersetzt_link: false,
  },
  // Mailed AND holding a link already, which is the pair the boolean exists for: it reads exactly
  // like the row above it on every other field.
  {
    team_id: ID("f"),
    team_name: "Wöhlerschule",
    empfaenger: [{ rolle: "stellvertretung", vorname: "Mila", email: "mila@beispiel.de" }],
    uebersprungen: null,
    ersetzt_link: true,
  },
  { team_id: ID("b"), team_name: "Georg-Büchner-Schule", empfaenger: [], uebersprungen: "kein_kontaktblock", ersetzt_link: false },
  {
    team_id: ID("c"),
    team_name: "Helene-Lange-Schule",
    empfaenger: [],
    uebersprungen: "keine_bestaetigte_kontaktperson",
    ersetzt_link: false,
  },
  { team_id: ID("d"), team_name: "Liebigschule", empfaenger: [], uebersprungen: "bereits_gesendet", ersetzt_link: false },
  { team_id: ID("e"), team_name: "Carl-von-Weinberg-Schule", empfaenger: [], uebersprungen: "austritt_eingetragen", ersetzt_link: false },
];

/** The same season with nothing standing to be replaced, which is what parts the two armed sentences. */
const OHNE_ERSATZ: readonly FLEinladungVersandVorschauZeile[] = VORSCHAU.map((zeile) => ({ ...zeile, ersetzt_link: false }));

const vorschauAntwort = (zeilen: readonly FLEinladungVersandVorschauZeile[]) => () => Promise.resolve({ success: true, zeilen: zeilen });

const panel = (isFinishedSaison = false) =>
  underNext(h(FormEinladungVersandSection, { saisonId: SAISON_ID, isFinishedSaison: isFinishedSaison }));

const RESTING = "Links an alle Teams senden";
const ARMED = "Ja, Links an alle Teams senden";
const RUNNING = "Sendet...";
const CANCEL = "Abbrechen";
const LISTE = "Wer den Link bekommt";

/** The value the armed readout states beside `label`, read off the description list the readout renders as. */
function readout(label: string): string | null {
  const at = screen.getAllByRole("term").findIndex((term) => term.textContent === label);

  return at === -1 ? null : (screen.getAllByRole("definition")[at]?.textContent ?? null);
}

/**
 * Awaited, never read at once: the first press arms only once the preview it asked for has landed,
 * which is after the press's own event and later still on a loaded machine.
 */
const armedStep = (): Promise<HTMLElement> => screen.findByRole("button", { name: ARMED });

beforeEach(() => {
  calls.length = 0;
  raised.length = 0;
  answerWith(running);
});

describe("the season's bulk invite send", () => {
  const zeile = (team_name: string): string => screen.getByText(team_name).closest("li")?.textContent ?? "";

  it("reads the preview on the first press and arms on the same gesture, over the rule the press then performs", async () => {
    const user = userEvent.setup();
    answerWith(vorschauAntwort(VORSCHAU));
    render(panel());

    await pressTwice(user, {
      resting: RESTING,
      armed: ARMED,
      whileArmed: () => {
        assert.deepEqual(
          sent("previewEinladungVersandAction"),
          [{ id: SAISON_ID, erneut: false }],
          "the preview was read without the value the press will carry",
        );
        assert.equal(sent("postEinladungVersandAction").length, 0, "one press wrote");
        assert.equal(readout("Teams"), "2");
        assert.equal(readout("E-Mails"), "3");
        assert.equal(readout("Übersprungen"), "4");
        answerWith(() => Promise.resolve({ success: true, zeilen: [], message: "1 von 4 Teams haben ihren Link bekommen." }));
      },
    });

    assert.deepEqual(sent("postEinladungVersandAction"), [{ id: SAISON_ID, erneut: false }]);
  });

  /* A preview the edge cut wrote nothing, so it is the failed read it is: uncaught in the preview's
     transition, it replaces the page with the error page. */
  it("answers a rejected preview as a failed read, and leaves the press at rest", async () => {
    const user = userEvent.setup();
    answerWith(() => Promise.reject(new Error("An unexpected response was received from the server.")));
    render(panel());

    await user.click(screen.getByRole("button", { name: RESTING }));
    await waitFor(() => assert.equal(raised.length, 1));

    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title, toast.description, toast.options?.outcome]),
      [["danger", "Vorschau nicht geladen", UNKNOWN_REFUSAL, undefined]],
    );
    assert.equal(sent("postEinladungVersandAction").length, 0, "a failed preview wrote");
    await screen.findByRole("button", { name: RESTING });
  });

  /* A send of unknown outcome may have mailed the links the list names, so a second press armed over
     that list would re-mint them under a readout of what was true before the write. */
  it("drops the list after a send of unknown outcome, so the next press reads it again", async () => {
    const user = userEvent.setup();
    const { router, seen } = recordingRouter();
    answerWith(vorschauAntwort(VORSCHAU));
    render(underNext(h(FormEinladungVersandSection, { saisonId: SAISON_ID, isFinishedSaison: false }), { router }));

    // Rejected, so the panel reads the page again itself: no answer brought the action's refresh.
    await pressTwice(user, {
      resting: RESTING,
      armed: ARMED,
      whileArmed: () => answerWith(() => Promise.reject(new TypeError("Failed to fetch"))),
    });
    await screen.findByRole("button", { name: RESTING });

    const { error, outcome } = unansweredAction();
    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title, toast.description, toast.options?.outcome]),
      [["danger", "Registrierungslinks nicht gesendet", error, outcome]],
    );
    assert.ok(screen.queryByText(LISTE) === null, "the list read before the write still stands");
    assert.equal(seen.refresh, 1, "the page was not read again");

    answerWith(vorschauAntwort(VORSCHAU));
    await user.click(screen.getByRole("button", { name: RESTING }));
    await armedStep();
    assert.equal(sent("previewEinladungVersandAction").length, 2, "the next press armed over the list read before the write");
  });

  /* The read holds the press until its list lands, and the list arms it: a render showing the press
     armed while still held drops the press a reader aims at it, and nothing is sent. */
  it("never shows the press armed while the read still holds it", async () => {
    const user = userEvent.setup();
    answerWith(vorschauAntwort(VORSCHAU));
    render(panel());

    // Every render the panel commits rather than the one a query lands on: the held one lasts a frame.
    const armedWhileHeld: boolean[] = [];
    const observer = new MutationObserver(() => {
      const armed = [...document.querySelectorAll("button")].find((button) => button.textContent.includes(ARMED));
      if (armed !== undefined) armedWhileHeld.push(armed.getAttribute("data-pending") === "true");
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    try {
      await user.click(screen.getByRole("button", { name: RESTING }));
      await armedStep();
      await waitFor(() => assert.equal(screen.getByRole("button", { name: ARMED }).getAttribute("data-pending"), null));
    } finally {
      observer.disconnect();
    }

    assert.ok(armedWhileHeld.length > 0, "no render showed the armed press, so nothing here was observed");
    assert.equal(armedWhileHeld.includes(true), false, "a render showed the press armed while the read still held it");
  });

  /* The armed control and the list it sends to say what is in flight
     (`fl_frontend/src/shared/hooks/useTwoPressConfirm.ts :: useTwoPressConfirm`), so neither may drop
     while the write still holds the press: bare, the alert counts zero teams over a running send. */
  it("keeps the armed send and its list until the write lets go of the press", async () => {
    const user = userEvent.setup();
    answerWith(vorschauAntwort(VORSCHAU));
    render(panel());

    // Every render the panel commits, as in the case above: the dropped state lasts until the transition ends.
    const droppedWhileSending: boolean[] = [];
    const observer = new MutationObserver(() => {
      const buttons = [...document.querySelectorAll("button")];
      if (buttons.some((button) => button.textContent.includes(RUNNING))) {
        const armed = buttons.some((button) => button.textContent.includes(CANCEL));
        droppedWhileSending.push(!armed || screen.queryByRole("heading", { name: LISTE }) === null);
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });
    try {
      await pressTwice(user, {
        resting: RESTING,
        armed: ARMED,
        whileArmed: () => answerWith(() => Promise.resolve({ success: true, zeilen: [], message: "Keine Links gesendet." })),
      });
      await waitFor(() => assert.equal(screen.getByRole("button", { name: RESTING }).getAttribute("data-pending"), null));
    } finally {
      observer.disconnect();
    }

    assert.ok(droppedWhileSending.length > 0, "no render showed the send running, so nothing here was observed");
    assert.equal(droppedWhileSending.includes(true), false, "a render dropped the armed send or its list while the write still held it");
  });

  /* The four are ordinary states of a season being set up, so each is named as itself: one sentence
     for all of them would send somebody hunting for a fault in the teams that have none. */
  it("names each of the four skips as its own state, beside the team it is about", async () => {
    const user = userEvent.setup();
    answerWith(vorschauAntwort(VORSCHAU));
    render(panel());

    await user.click(screen.getByRole("button", { name: RESTING }));
    await armedStep();

    assert.ok(isInTheFlow("Keine Kontaktdaten hinterlegt"), "the team with no contact block is not told apart");
    assert.ok(isInTheFlow("Niemand hat die Kontaktdaten bisher selbst bestätigt"), "the team with no confirmed seat is not told apart");
    assert.ok(isInTheFlow("Hat den Link schon bekommen"), "the team already mailed is not told apart");
    assert.ok(isInTheFlow("Austritt eingetragen"), "the club that has left is not told apart");
    assert.ok(isInTheFlow("erika@beispiel.de, jonas@beispiel.de"), "the addresses the press would write to are not listed");
  });

  /* A stored link is a hash, so there is nothing to send twice: choosing the re-send mints, and the
     link those teams already hold stops opening anything. */
  it("says what the re-send costs under the switch that offers it", async () => {
    const user = userEvent.setup();
    answerWith(vorschauAntwort(VORSCHAU));
    render(panel());

    const kosten = "Der Link, den sie schon haben, funktioniert danach nicht mehr.";
    assert.equal(isInTheFlow(kosten), false, "the cost of a re-send stands on a page nobody has chosen one on");

    await user.click(screen.getByRole("switch"));
    assert.ok(isInTheFlow(kosten), "the switch is on and nothing says what it costs");
  });

  /* `erneut` cannot answer this: a team holding a link nobody mailed is written to with the switch
     OFF and loses that link all the same, and its row reads like any other but for this field. */
  it("names the teams losing a link from the rows rather than from the opt-in", async () => {
    const user = userEvent.setup();
    answerWith(vorschauAntwort(VORSCHAU));
    render(panel());

    await user.click(screen.getByRole("button", { name: RESTING }));
    await armedStep();

    assert.ok(isInTheFlow("Ersetzt den Link, den dieses Team schon hat"), "the row whose link this press kills says nothing");
    assert.equal(readout("Verlieren ihren Link"), "1");
    // The sentence names no count: the readout above carries it, and a numeral written before a
    // plural noun reads wrong at one.
    assert.match(
      screen.getByRole("alert").textContent,
      /Bei den Teams, die ihren Link verlieren, funktioniert der bisherige danach nicht mehr/,
    );
  });

  it("claims no loss where no row carries one", async () => {
    const user = userEvent.setup();
    answerWith(vorschauAntwort(OHNE_ERSATZ));
    render(panel());

    await user.click(screen.getByRole("button", { name: RESTING }));
    await armedStep();

    assert.equal(isInTheFlow("Ersetzt den Link, den dieses Team schon hat"), false, "a row that replaces nothing says it does");
    assert.equal(readout("Verlieren ihren Link"), "0");
    const alert = screen.getByRole("alert").textContent;
    assert.match(alert, /Jedes dieser Teams bekommt einen frischen Link/);
    assert.doesNotMatch(alert, /funktioniert der Link, den sie schon haben/, "the armed step claims a loss this press does not cause");
  });

  /* The endpoint judged the skips with `erneut` false, so the list it answered is about the other
     value the moment the switch moves: kept, it would name a skip the press is about to ignore. */
  it("drops the loaded list when the re-send opt-in moves, and sends the choice with the press", async () => {
    const user = userEvent.setup();
    answerWith(vorschauAntwort(VORSCHAU));
    render(panel());

    await user.click(screen.getByRole("button", { name: RESTING }));
    await armedStep();
    assert.ok(isInTheFlow("Hat den Link schon bekommen"), "the preview never landed, so the drop below proves nothing");

    await user.click(screen.getByRole("switch"));
    assert.equal(isInTheFlow("Hat den Link schon bekommen"), false, "the list judged with the other value is still on screen");
    assert.ok(screen.queryByRole("alert") === null, "the armed step outlived the list it was armed over");

    await pressTwice(user, {
      resting: RESTING,
      armed: ARMED,
      whileArmed: () => {
        assert.deepEqual(
          sent("previewEinladungVersandAction").at(-1),
          { id: SAISON_ID, erneut: true },
          "the second read described the press the switch had already moved off",
        );
        answerWith(() => Promise.resolve({ success: true, zeilen: [], message: "4 von 4 Teams haben ihren Link bekommen." }));
      },
    });

    assert.deepEqual(sent("postEinladungVersandAction"), [{ id: SAISON_ID, erneut: true }]);
  });

  it("answers a season with no admitted team with an empty state rather than an armed press", async () => {
    const user = userEvent.setup();
    answerWith(vorschauAntwort([]));
    render(panel());

    await user.click(screen.getByRole("button", { name: RESTING }));

    // Nothing arms here to be awaited, so the empty state is.
    await waitFor(() => assert.ok(isInTheFlow("Diese Saison hat noch kein Team aufgenommen"), "an empty season states nothing"));
    assert.ok(screen.queryByRole("alert") === null, "an empty season armed a press with nothing behind it");
    // Awaited, because the control is pending-marked while the read it was handed is still in
    // flight, and a closed control is only announced as closed once that mark lifts.
    await screen.findByRole("button", { name: RESTING, description: "Diese Saison hat noch kein Team aufgenommen." });
    closedControl(RESTING, "Diese Saison hat noch kein Team aufgenommen.");
  });

  /* Sixteen mails to strangers is not a write a second press is optional for, and the two
     clicks here land inside the window the hook reads as one motor action. */
  it("writes nothing when the two presses land inside one double click", async () => {
    const user = userEvent.setup();
    answerWith(vorschauAntwort(VORSCHAU));
    render(panel());

    // The clock held still, so waiting for the armed step cannot carry the second press past the window.
    mock.timers.enable({ apis: ["Date"] });
    try {
      await user.click(screen.getByRole("button", { name: RESTING }));
      await user.click(await armedStep());
    } finally {
      mock.timers.reset();
    }

    assert.equal(sent("postEinladungVersandAction").length, 0, "a double click sent the whole season its links");
    assert.ok(screen.getByRole("alert"), "the armed step was dropped by the click it was supposed to ignore");
  });

  it("explains a finished season rather than offering it a press", () => {
    render(panel(true));

    assert.ok(isInTheFlow("Für eine abgeschlossene Saison werden keine Registrierungslinks mehr gesendet"));
    assert.ok(screen.queryByRole("button", { name: RESTING }) === null, "a finished season is offered a press the endpoint refuses");
    assert.ok(screen.queryByRole("switch") === null, "a finished season is offered the re-send choice");
  });

  /* The partial row is the one a shortfall hides in: a count of what went out says nothing about
     who was missed. */
  it("reports what became of each team after the press, the addresses it could not reach included", async () => {
    const user = userEvent.setup();
    answerWith(vorschauAntwort(VORSCHAU));
    render(panel());

    await pressTwice(user, {
      resting: RESTING,
      armed: ARMED,
      whileArmed: () => {
        answerWith(() =>
          Promise.resolve({
            success: true,
            message: "Registrierungslinks gesendet: 2 von 3 Teams.",
            zeilen: [
              {
                team_id: ID("a"),
                team_name: "Ernst-Reuter-Schule",
                uebersprungen: null,
                ersetzt_link: true,
                zugestellt: ["erika@beispiel.de"],
                unerreichbar: [],
                zurueckgehalten: [],
              },
              {
                team_id: ID("f"),
                team_name: "Wöhlerschule",
                uebersprungen: null,
                ersetzt_link: false,
                zugestellt: ["mila@beispiel.de", "til@beispiel.de"],
                unerreichbar: ["gelöscht@beispiel.de"],
                zurueckgehalten: [],
              },
              // The row every team carries on every stack but production: nobody was written to, and
              // nobody was refused either.
              {
                team_id: ID("c"),
                team_name: "Helene-Lange-Schule",
                uebersprungen: null,
                ersetzt_link: false,
                zugestellt: [],
                unerreichbar: ["holger@beispiel.de"],
                zurueckgehalten: ["holger@beispiel.de"],
              },
              {
                team_id: ID("b"),
                team_name: "Georg-Büchner-Schule",
                uebersprungen: "kein_kontaktblock",
                ersetzt_link: false,
                zugestellt: [],
                unerreichbar: [],
                zurueckgehalten: [],
              },
              // The one value that is a failure rather than a state: its transaction rolled back, so
              // this team was not written to AND keeps the link it already had.
              {
                team_id: ID("g"),
                team_name: "Bettinaschule",
                uebersprungen: "erzeugung_fehlgeschlagen",
                ersetzt_link: false,
                hatte_link: true,
                zugestellt: [],
                unerreichbar: [],
                zurueckgehalten: [],
              },
            ],
          }),
        );
      },
    });

    // The result renders once the write the second press started answers, after that press's own event.
    await waitFor(() => assert.ok(isInTheFlow("An die Adresse gesendet"), "the team reached at its one address reports nothing"));
    assert.ok(isInTheFlow("Gesendet: 2 von 3"), "the team reached in part reads as reached whole");
    assert.ok(
      isInTheFlow("Nicht erreicht: gelöscht@beispiel.de"),
      "the address nobody reached is named nowhere, so nobody can write to it by hand",
    );
    /* Outside production this is EVERY row, so grading it as a failure and naming each address in
       danger red teaches an administrator that the red rows mean nothing. */
    assert.ok(isInTheFlow(ZURUECKGEHALTEN), "a row the deployment withheld reads as a team the league failed to reach");
    assert.equal(isInTheFlow("Nicht erreicht: holger@beispiel.de"), false, "a withheld address is offered for writing to by hand");
    assert.ok(isInTheFlow("Der bisherige Link dieses Teams funktioniert nicht mehr"), "the team that lost a link is not told apart afterwards");
    assert.ok(isInTheFlow("Keine Kontaktdaten hinterlegt"), "the skipped team lost its reason in the result");
    assert.ok(isInTheFlow("Registrierungslink nicht angelegt"), "the team whose mint failed is not told apart from one passed over on purpose");
    assert.ok(
      isInTheFlow("Der bisherige Link dieses Teams gilt weiter. Ein neuer Versand versucht es noch einmal."),
      "nothing says the failed team keeps the link it had, so somebody will assume it lost one",
    );
    assert.equal(raised[0]?.variant, "success");
  });

  /* The commit went out and no answer came back, so the row is true of a link revoked and of one
     that still opens, and says nothing about a previous link to a team that held none. */
  it("words a mint of unknown outcome apart from a failed one, naming a previous link only where there was one", async () => {
    const user = userEvent.setup();
    answerWith(vorschauAntwort(VORSCHAU));
    render(panel());

    const unklar = (team_id: string, team_name: string, ersetzt_link: boolean) => ({
      team_id,
      team_name,
      uebersprungen: "erzeugung_ungewiss",
      ersetzt_link,
      zugestellt: [],
      unerreichbar: [],
      zurueckgehalten: [],
    });

    await pressTwice(user, {
      resting: RESTING,
      armed: ARMED,
      whileArmed: () => {
        answerWith(() =>
          Promise.resolve({
            success: true,
            message: "Registrierungslinks gesendet: 0 von 2 Teams.",
            zeilen: [unklar(ID("a"), "Ernst-Reuter-Schule", true), unklar(ID("f"), "Wöhlerschule", false)],
          }),
        );
      },
    });

    await waitFor(() => assert.ok(zeile("Ernst-Reuter-Schule").includes("Unklar"), "the result rows did not render"));
    assert.equal(
      zeile("Ernst-Reuter-Schule"),
      "Ernst-Reuter-Schule" +
        "Unklar, ob ein neuer Registrierungslink angelegt wurde" +
        "Der bisherige Link dieses Teams gilt vielleicht nicht mehr. " +
        "Ein neuer Versand schickt dem Team einen Link, wenn sein bisheriger nicht mehr gilt oder es noch keinen bekommen hat.",
    );
    assert.equal(
      zeile("Wöhlerschule"),
      "Wöhlerschule" +
        "Unklar, ob ein neuer Registrierungslink angelegt wurde" +
        "Ein neuer Versand schickt dem Team einen Link, wenn sein bisheriger nicht mehr gilt oder es noch keinen bekommen hat.",
    );
  });

  /* A rollback leaves the team as it was, and a team that held no link, or whose link the press
     failed before reading, keeps nothing a sentence may name. */
  it("says a failed team keeps its link only where the press found one", async () => {
    const user = userEvent.setup();
    answerWith(vorschauAntwort(VORSCHAU));
    render(panel());

    const fehlgeschlagen = (team_id: string, team_name: string, hatte_link: boolean | null) => ({
      team_id,
      team_name,
      uebersprungen: "erzeugung_fehlgeschlagen",
      ersetzt_link: false,
      hatte_link,
      zugestellt: [],
      unerreichbar: [],
      zurueckgehalten: [],
    });

    await pressTwice(user, {
      resting: RESTING,
      armed: ARMED,
      whileArmed: () => {
        answerWith(() =>
          Promise.resolve({
            success: true,
            message: "Registrierungslinks gesendet: 0 von 3 Teams.",
            zeilen: [
              fehlgeschlagen(ID("a"), "Ernst-Reuter-Schule", true),
              fehlgeschlagen(ID("f"), "Wöhlerschule", false),
              fehlgeschlagen(ID("g"), "Bettinaschule", null),
            ],
          }),
        );
      },
    });

    await waitFor(() => assert.ok(zeile("Ernst-Reuter-Schule").includes("nicht angelegt"), "the result rows did not render"));
    assert.equal(
      zeile("Ernst-Reuter-Schule"),
      "Ernst-Reuter-Schule" +
        "Registrierungslink nicht angelegt" +
        "Der bisherige Link dieses Teams gilt weiter. Ein neuer Versand versucht es noch einmal.",
    );
    for (const team_name of ["Wöhlerschule", "Bettinaschule"]) {
      assert.equal(zeile(team_name), team_name + "Registrierungslink nicht angelegt" + "Ein neuer Versand versucht es noch einmal.");
    }
  });
});
