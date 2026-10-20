import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleEveryAction, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLSpielbestaetigungSelbst } from "@/features/spielbestaetigungen/schemas.ts";

doubleEveryAction({ payloadOf: (args) => args });
doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { EINSAETZE_LEER, SchiedsrichterEinsaetzeSection, VERGANGENE_EINSAETZE } = await import("./SchiedsrichterEinsaetzeSection.tsx");

/** One of the referee's rows, open and still to come unless a case says otherwise. */
const einsatz = (n: number, team2_name: string, fields: Partial<FLSpielbestaetigungSelbst> = {}): FLSpielbestaetigungSelbst => ({
  id: `6890a1b2c3d4e5f6074900${String(n).padStart(2, "0")}`,
  spiel_id: `6890a1b2c3d4e5f6074901${String(n).padStart(2, "0")}`,
  schiedsrichter_id: "6890a1b2c3d4e5f607490200",
  ansetzung: { team1_name: "Ernst-Reuter-Schule", team2_name: team2_name, datum: "2026-11-20", uhrzeit: "14:30:00", spielort: null },
  zustand: "gueltig",
  begruendung: null,
  eingetragen: false,
  vergangen: false,
  ...fields,
});

const renderSection = (einsaetze: readonly FLSpielbestaetigungSelbst[]) => render(underNext(h(SchiedsrichterEinsaetzeSection, { einsaetze })));

describe("a referee's fixtures, to come and gone by", () => {
  /* In May a season's past would stand ahead of next Saturday's fixture, and the empty state would never show again. */
  it("lists the fixtures to come apart from the past, and says none is booked where only the past remains", () => {
    const { unmount } = renderSection([
      einsatz(1, "Goethe-Gymnasium"),
      einsatz(2, "Lessing-Gymnasium", { zustand: "zugesagt", vergangen: true }),
    ]);

    const [kommend, vergangen] = screen.getAllByRole("list");
    assert.ok(kommend !== undefined && within(kommend).getByText("Ernst-Reuter-Schule gegen Goethe-Gymnasium"));
    assert.ok(vergangen !== undefined && within(vergangen).getByText("Ernst-Reuter-Schule gegen Lessing-Gymnasium"));
    assert.ok(screen.getByRole("heading", { level: 3, name: VERGANGENE_EINSAETZE }));
    unmount();

    renderSection([einsatz(2, "Lessing-Gymnasium", { zustand: "zugesagt", vergangen: true })]);
    assert.ok(screen.getByText(EINSAETZE_LEER));
  });

  it("draws no past group where nothing is past", () => {
    renderSection([einsatz(1, "Goethe-Gymnasium")]);

    assert.equal(screen.queryAllByRole("heading", { level: 3, name: VERGANGENE_EINSAETZE }).length, 0);
  });
});

describe("a referee's spent rows", () => {
  /* The fixture's own word, never „Abgesagt“ alone, which is the referee's own decline: a referee reading it as theirs
     would not know the match is off. */
  it("reads a called-off fixture as called off, apart from the referee's own decline", () => {
    renderSection([
      einsatz(1, "Goethe-Gymnasium", { zustand: "abgesagt" }),
      einsatz(2, "Lessing-Gymnasium", { zustand: "abgelehnt", begruendung: "Klassenfahrt" }),
    ]);

    assert.deepEqual([screen.getAllByText("Spiel abgesagt").length, screen.getAllByText("Abgesagt").length], [1, 1]);
    assert.equal(screen.queryAllByRole("button", { name: /^(Zusagen|Absagen)/ }).length, 0, "a spent row offers an answer");
  });

  it("says an unanswered row whose day or fixture is spent takes no answer", () => {
    renderSection([einsatz(1, "Goethe-Gymnasium", { zustand: "abgelaufen" })]);

    assert.ok(screen.getByText("Keine Antwort mehr möglich"));
    assert.equal(screen.queryAllByRole("button", { name: /^(Zusagen|Absagen)/ }).length, 0, "a spent row offers an answer");
  });
});

describe("a referee's decline, row by row", () => {
  /* Two open rows hold a box and a send each, which a screen reader's list of controls must tell apart (WCAG 2.5.3). */
  it("names each row's reason box and send for its fixture", async () => {
    const user = userEvent.setup();
    renderSection([einsatz(1, "Goethe-Gymnasium"), einsatz(2, "Lessing-Gymnasium")]);
    for (const trigger of screen.getAllByRole("button", { name: /^Absagen/ })) await user.click(trigger);

    for (const team2 of ["Goethe-Gymnasium", "Lessing-Gymnasium"]) {
      const wofuer = `Ernst-Reuter-Schule gegen ${team2} am 20.11.2026`;
      assert.ok(screen.getByRole("textbox", { name: `Begründung: ${wofuer}` }));
      assert.ok(screen.getByRole("button", { name: `Absage senden: ${wofuer}` }));
    }
  });
});
