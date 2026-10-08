import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLKaderZeile } from "@/features/spieler/schemas.ts";

/* Every save answers as landed; the editor reaches the stub along the path it reaches the action. */
const { calls, answered } = doubleActions({ modules: ["/src/features/spieler/personActions.ts"] });
doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { KaderZeileEditForm } = await import("./KaderZeileEditForm.tsx");
const { KaderZeileAusgetragen } = await import("./KaderZeileAusgetragen.tsx");

const TEAM_A = "6890a1b2c3d4e5f607250011";
const MIA = "68c1f0a2b3c4d5e6f7a8b932";
const KADER_HREF = `/bereich/team/${TEAM_A}/2526/kader`;

/** Mia's live row, wearing a number another row shares. */
const MIAS_ZEILE: FLKaderZeile = {
  spieler_id: MIA,
  vorname: "Mia",
  nachname: "Schmidt",
  nummer: "7",
  position: "Tor",
  stufe: "Q1",
  rolle: null,
  ist_nachnominiert: false,
  inactive_since: null,
  nummer_doppelt: true,
};

const editor = (zeile: FLKaderZeile, erlaubteStufen: FLKaderZeile["stufe"][] = ["Q1"]) =>
  underNext(
    h(KaderZeileEditForm, {
      teamId: TEAM_A,
      saisonId: "2526",
      zeile,
      erlaubteStufen: erlaubteStufen.filter((stufe) => stufe !== null),
      heldRollen: { kapitaen: "Lena Meier-Lüdenscheid" },
      kaderHref: KADER_HREF,
    }),
  );

describe("what a seat holder's editor offers", () => {
  /* The season's levels in the league's order, and the row's own stored level where the season was
     narrowed after it: the write takes that one back unchanged, and a picker without it shows nothing. */
  for (const [stufe, offered] of [
    ["Q1", ["Keine Angabe", "E1", "Q2", "Q1"]],
    ["E1", ["Keine Angabe", "E1", "Q2"]],
  ] as const) {
    it(`offers the season's levels to a row stored at ${stufe}, its own level among them`, async () => {
      const user = userEvent.setup();
      render(editor({ ...MIAS_ZEILE, stufe }, ["E1", "Q2"]));
      await user.click(screen.getByRole("button", { name: /Stufe/ }));

      assert.deepEqual(
        screen.getAllByRole("option").map((option) => option.textContent.trim()),
        offered,
      );
    });
  }

  it("offers no captaincy another live row holds", () => {
    render(editor(MIAS_ZEILE));

    assert.ok(screen.getByRole("radio", { name: "Kapitän" }).hasAttribute("disabled"), "the captaincy another row holds is offered");
    assert.ok(!screen.getByRole("radio", { name: "Co-Kapitän" }).hasAttribute("disabled"), "a captaincy nobody holds is closed");
  });
});

describe("saving one squad row", () => {
  /** The editor's number box entered over with `nummer` and left, then Speichern pressed and its write answered. */
  async function saveWithNummer(nummer: string): Promise<void> {
    const user = userEvent.setup();
    render(editor(MIAS_ZEILE));
    const box = screen.getByRole("textbox", { name: "Nummer" });
    await user.clear(box);
    await user.paste(nummer);
    await act(async () => box.blur());
    calls.length = 0;

    await user.click(screen.getByRole("button", { name: "Speichern" }));
    await act(answered);
  }

  it("sends the four fields and the row's three ids, and nothing else", async () => {
    await saveWithNummer("12");

    assert.deepEqual(calls, [
      {
        action: "patchKaderZeileAction",
        payload: { team_id: TEAM_A, saison_id: "2526", spieler_id: MIA, nummer: "12", position: "Tor", stufe: "Q1", rolle: null },
      },
    ]);
  });

  /* The form's own schema is the gate: a draft it refuses never reaches the action, whatever the server would say. */
  it("sends nothing for a number the schema refuses, and marks the box", async () => {
    await saveWithNummer("7a");

    assert.deepEqual(calls, [], "a draft the schema refuses was sent");
    assert.equal(screen.getByRole("textbox", { name: "Nummer" }).getAttribute("aria-invalid"), "true");
  });
});

describe("an ausgetragen row's own page", () => {
  /* Every fact of the row is labelled here, so an empty one reads as every labelled empty field does. */
  it("names an empty shirt number as every labelled empty field reads", () => {
    const { container } = render(
      underNext(h(KaderZeileAusgetragen, { zeile: { ...MIAS_ZEILE, nummer: null, inactive_since: "2026-03-01" }, kaderHref: KADER_HREF })),
    );

    assert.match(container.textContent.replace(/\s+/g, " "), /Nummer\s?Nicht hinterlegt/);
  });
});
