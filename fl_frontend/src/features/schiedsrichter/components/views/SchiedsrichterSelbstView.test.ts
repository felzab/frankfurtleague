import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { act, render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleEveryAction, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { assertLeer } from "@/shared/testing/leerGrade.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { schiedsrichterSelbst } from "@/shared/testing/selbstFixtures.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { FLSpielberichtPersonEintrag } from "@/features/spielberichte/schemas.ts";
import type { FLSpielbestaetigungSelbst } from "@/features/spielbestaetigungen/schemas.ts";
import type { FLSchiedsrichterSelbst } from "../../schemas.ts";

// Every argument recorded: the decline's reason rides in its second.
const { calls, answered } = doubleEveryAction({ payloadOf: (args) => args });
doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SchiedsrichterSelbstView } = await import("./SchiedsrichterSelbstView.tsx");
const { FLSchiedsrichterSelbstSchema } = await import("../../schemas.ts");
const { EINSAETZE_LEER } = await import("@/features/spielbestaetigungen/components/views/SchiedsrichterEinsaetzeSection.tsx");

// The school and the phone filled, so each of the panel's rows shows a stored value.
const SCHIEDSRICHTERIN: FLSchiedsrichterSelbst = FLSchiedsrichterSelbstSchema.parse({
  ...schiedsrichterSelbst(),
  schule: "Lessing-Gymnasium",
  kontakt: { telefon: "069 1234567", email: "mara@example.org" },
});

/** One open row of the referee's, as their own read serves it. */
const EINSATZ: FLSpielbestaetigungSelbst = {
  id: "6890a1b2c3d4e5f607390051",
  spiel_id: "6890a1b2c3d4e5f607390061",
  schiedsrichter_id: SCHIEDSRICHTERIN.schiedsrichter_id,
  ansetzung: { team1_name: "Ernst-Reuter-Schule", team2_name: "Goethe-Gymnasium", datum: "2026-11-20", uhrzeit: "14:30:00", spielort: null },
  zustand: "gueltig",
  begruendung: null,
  eingetragen: false,
};

const GELEITET: FLSpielberichtPersonEintrag = {
  spiel_id: "6890a1b2c3d4e5f607390101",
  datum: "2026-10-17",
  uhrzeit: "15:00:00",
  team1_name: "Goethe-Gymnasium",
  team2_name: "Lessing-Gymnasium",
  eingereicht_am: null,
};

const renderView = (
  schiedsrichter: readonly FLSchiedsrichterSelbst[] = [SCHIEDSRICHTERIN],
  {
    einsaetze = [],
    spielberichte = null,
  }: { einsaetze?: readonly FLSpielbestaetigungSelbst[]; spielberichte?: readonly FLSpielberichtPersonEintrag[] | null } = {},
) => render(underNext(h(SchiedsrichterSelbstView, { schiedsrichter, einsaetze, spielberichte })));

describe("a referee's own page", () => {
  /* The person tier's read, read by the person it names: the whole name and their own contact details. */
  /* The fee among them: the referee's confirmation page lists it as stored, so the page shows it. */
  it("shows the whole name, the school, the contact details, the birthdate and the fee under one panel heading", () => {
    renderView();

    assert.equal(screen.getAllByRole("heading", { level: 2, name: "Deine Angaben" }).length, 1);
    // The fee with a plain space: the matcher folds the node's whitespace, the formatter's no-break space among it, and never its own.
    for (const wert of ["Mara Okafor", "Lessing-Gymnasium", "mara@example.org", "069 1234567", "01.03.2007", "25,00 €"]) {
      assert.ok(screen.getByText(wert), `the page does not show „${wert}“`);
    }
  });

  /* A row with no address of its own holds a placeholder, which is no address the person could use. */
  it("names an absent address, school and telephone as not recorded, never the placeholder", () => {
    renderView([{ ...SCHIEDSRICHTERIN, schule: null, kontakt: { telefon: null, email: "ohne-adresse@example.invalid" } }]);

    assert.equal(screen.getAllByText("Nicht hinterlegt").length, 3);
    for (const leer of screen.getAllByText("Nicht hinterlegt")) assertLeer(leer, "Nicht hinterlegt");
    assert.equal(screen.queryAllByText(/\.invalid/).length, 0, "the page shows the placeholder address");
  });

  /* One address may hold several referee rows; each is its own panel. */
  it("shows one panel per referee row the address holds", () => {
    renderView([SCHIEDSRICHTERIN, { ...SCHIEDSRICHTERIN, schiedsrichter_id: "6890a1b2c3d4e5f607390042", name: "Mara O." }]);

    assert.equal(screen.getAllByRole("heading", { level: 2, name: "Deine Angaben" }).length, 2);
  });

  /* The referee's control lives on the account page, so this page offers none and sends the reader there. */
  it("offers no consent control and links the account page", () => {
    const { container } = renderView();

    assert.equal(screen.queryAllByRole("switch").length + screen.queryAllByRole("radiogroup").length, 0);
    assert.equal(within(container).getByRole("link", { name: "Konto" }).getAttribute("href"), "/bereich/konto");
  });

  /* The control it points to moves the schedule listing and the media consent both, so the pointer names both. */
  it("points to the account page for both choices", () => {
    const { container } = renderView();

    const pointer = within(container).getByRole("link", { name: "Konto" }).closest("p")?.textContent ?? "";
    assert.ok(pointer.includes("im Spielplan") && pointer.includes("auf der Website"), pointer);
  });

  /* Each played fixture leads to its own report, and the press names the fixture it opens. */
  it("links each fixture's report under its pairing, open or sent", () => {
    renderView([SCHIEDSRICHTERIN], {
      spielberichte: [GELEITET, { ...GELEITET, spiel_id: "6890a1b2c3d4e5f607390102", eingereicht_am: "2026-10-17T18:00:00Z" }],
    });

    const eintragen = screen.getByRole("link", { name: "Spielbericht eintragen: Goethe-Gymnasium gegen Lessing-Gymnasium" });
    assert.equal(eintragen.getAttribute("href"), "/bereich/schiedsrichter/spielbericht/6890a1b2c3d4e5f607390101");
    assert.equal(
      screen.getByRole("link", { name: "Spielbericht ansehen: Goethe-Gymnasium gegen Lessing-Gymnasium" }).getAttribute("href"),
      "/bereich/schiedsrichter/spielbericht/6890a1b2c3d4e5f607390102",
    );
  });

  /* Closed, the section names why it offers nothing, so a referee does not read an empty season. */
  it("offers no report link while the reports are closed, and says so", () => {
    renderView([SCHIEDSRICHTERIN], { spielberichte: null });

    assert.equal(screen.queryAllByRole("link", { name: /^Spielbericht/ }).length, 0);
    assert.ok(screen.getByText(/noch nicht freigeschaltet/));
  });
});

describe("a referee's fixtures on their own page", () => {
  /* The section's empty state stands only where the list is empty: one drawn unconditionally passes the first half alone. */
  it("lists a booked fixture above the referee's data, and says so where none is booked", () => {
    const { unmount } = renderView([SCHIEDSRICHTERIN], { einsaetze: [EINSATZ] });

    assert.deepEqual(
      screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent),
      ["Deine Einsätze", "Spielberichte", "Deine Angaben"],
    );
    assert.ok(screen.getByText("Ernst-Reuter-Schule gegen Goethe-Gymnasium"));
    assert.equal(screen.queryAllByText(EINSAETZE_LEER).length, 0, "a referee booked on a fixture is told they are booked on none");
    unmount();

    renderView([SCHIEDSRICHTERIN], { einsaetze: [] });
    assert.ok(screen.getByText(EINSAETZE_LEER));
  });

  /* Two rows each offer both answers, so each control names its fixture beside its words (WCAG 2.5.3). */
  it("offers an open row both answers, each named for its fixture", () => {
    renderView([SCHIEDSRICHTERIN], { einsaetze: [EINSATZ] });

    for (const worte of ["Zusagen", "Absagen"]) {
      assert.ok(screen.getByRole("button", { name: `${worte}: Ernst-Reuter-Schule gegen Goethe-Gymnasium am 20.11.2026` }));
    }
  });

  /* A spent row offers nothing to press, and a decline shows the reason the referee gave. */
  it("shows a spent row's answer in place of the controls", () => {
    renderView([SCHIEDSRICHTERIN], {
      einsaetze: [
        { ...EINSATZ, zustand: "zugesagt" },
        { ...EINSATZ, id: "6890a1b2c3d4e5f607390052", zustand: "abgelehnt", begruendung: "Klassenfahrt" },
        { ...EINSATZ, id: "6890a1b2c3d4e5f607390053", zustand: "ungueltig" },
      ],
    });

    assert.equal(screen.queryAllByRole("button", { name: /^(Zusagen|Absagen)/ }).length, 0, "a spent row offers an answer");
    for (const wort of ["Zugesagt", "Abgesagt", "Klassenfahrt", "Nicht mehr gültig: Termin oder Einteilung haben sich geändert"]) {
      assert.ok(screen.getByText(wort), `the spent rows do not show „${wort}“`);
    }
  });

  /* The league may enter a referee's Zusage, which puts them on the schedule as their own does: the panel says whose it
     is, or the referee reads an agreement they never gave as theirs. */
  it("marks a Zusage the league entered as the league's, and the referee's own as theirs", () => {
    renderView([SCHIEDSRICHTERIN], {
      einsaetze: [
        { ...EINSATZ, zustand: "zugesagt", eingetragen: true },
        { ...EINSATZ, id: "6890a1b2c3d4e5f607390052", zustand: "zugesagt" },
      ],
    });

    assert.equal(screen.getAllByText("Zusage von der Verwaltung eingetragen").length, 1);
    assert.equal(screen.getAllByText("Zugesagt").length, 1);
  });

  /* The endpoint takes no decline without its reason, so the form sends none: the box says why instead. */
  it("sends a decline with its reason, and none without one", async () => {
    const user = userEvent.setup();
    renderView([SCHIEDSRICHTERIN], { einsaetze: [EINSATZ] });
    await user.click(screen.getByRole("button", { name: /^Absagen/ }));
    calls.length = 0;

    await user.click(screen.getByRole("button", { name: "Absage senden" }));
    await act(answered);
    assert.deepEqual(calls, [], "a decline without its reason was sent");
    assert.ok(screen.getByText("Bitte gib einen Grund für Deine Absage an."));

    await user.type(screen.getByRole("textbox", { name: "Begründung" }), "Klassenfahrt");
    await user.click(screen.getByRole("button", { name: "Absage senden" }));
    await act(answered);
    assert.deepEqual(calls, [{ action: "absagenSpielbestaetigungAction", payload: [EINSATZ.id, { begruendung: "Klassenfahrt" }] }]);
  });

  /* The first answer binds and the panel offers no way back, so a press on the wrong row of a list must not commit. */
  it("arms an acceptance on the first press and sends it for the row pressed on the second", async () => {
    const user = userEvent.setup();
    renderView([SCHIEDSRICHTERIN], { einsaetze: [EINSATZ] });
    calls.length = 0;

    await pressTwice(user, {
      resting: /^Zusagen/,
      armed: "Ja, zusagen",
      whileArmed: () => assert.deepEqual(calls, [], "the first press sent the acceptance"),
    });
    await act(answered);
    assert.deepEqual(calls, [{ action: "zusagenSpielbestaetigungAction", payload: [EINSATZ.id] }]);
  });
});
