import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { spielerSelbst } from "@/shared/testing/selbstFixtures.ts";

import type { FLSpielerSelbst, FLSpielerSelbstKaderZeile } from "../../schemas.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SpielerSelbstView } = await import("./SpielerSelbstView.tsx");
const { FLSpielerSelbstSchema } = await import("../../schemas.ts");

const LAUFEND: FLSpielerSelbstKaderZeile = {
  team_id: "6890a1b2c3d4e5f607390041",
  team_name: "Lessing Lions",
  saison_id: "2026",
  nummer: "07",
  position: "Angriff",
  stufe: "Q1",
  rolle: "kapitaen",
  ist_nachnominiert: true,
  inactive_since: null,
};

/** The season before, under the name the club played it under, and left mid-season. */
const AUSGETRAGEN: FLSpielerSelbstKaderZeile = {
  ...LAUFEND,
  team_name: "Lessing Löwen",
  saison_id: "2025",
  nummer: null,
  position: null,
  stufe: null,
  rolle: null,
  ist_nachnominiert: true,
  inactive_since: "2026-03-14",
};

// A hyphenated surname, so a page showing the public initial would show a different name.
const SPIELERIN: FLSpielerSelbst = FLSpielerSelbstSchema.parse({
  ...spielerSelbst(),
  nachname: "Fischer-Okafor",
  kader: [LAUFEND, AUSGETRAGEN],
});

const renderView = (spieler: FLSpielerSelbst = SPIELERIN) => render(underNext(h(SpielerSelbstView, { spieler })));

describe("a pupil's own page", () => {
  /* The person tier's read, read by the person it names: the surname whole, never the public initial. */
  it("shows the whole name and the birthdate under one panel heading", () => {
    renderView();

    assert.equal(screen.getAllByRole("heading", { level: 2, name: "Deine Angaben" }).length, 1);
    assert.ok(screen.getByText("Alina Fischer-Okafor"));
    assert.ok(screen.getByText("02.05.2008"));
  });

  /* A pupil the league holds no surname for reads by the first name alone, never with the empty one spelled out. */
  it("shows the first name alone where no surname is stored", () => {
    renderView({ ...SPIELERIN, nachname: null });

    const name = screen.getByText("Alina");
    assert.equal(name.textContent, "Alina");
    assert.ok(!document.body.textContent.includes("null"), "the missing surname is spelled out");
  });

  it("links each squad to the season it played in, under the name the club played it under", () => {
    renderView();

    const laufend = screen.getByRole("link", { name: "Kader von Lessing Lions ansehen" });
    const frueher = screen.getByRole("link", { name: "Kader von Lessing Löwen ansehen" });
    assert.equal(laufend.getAttribute("href"), `/dashboard/spieler/${LAUFEND.team_id}?saison_id=2026`);
    assert.equal(frueher.getAttribute("href"), `/dashboard/spieler/${AUSGETRAGEN.team_id}?saison_id=2025`);
  });

  /* The administrator's squad list grades the two facts so: a row taken out of the squad says when,
     and its late entry then matters to nobody reading it. */
  it("marks a squad left mid-season with its date, in place of the late entry", () => {
    renderView();

    const [laufend, frueher] = screen.getAllByRole("listitem");
    assert.ok(laufend !== undefined && frueher !== undefined, "the page lists fewer than the two squads");
    assert.ok(within(laufend).getByText("Nachnominiert"));
    assert.ok(within(laufend).getByText("Nummer 07 · Angriff · Q1 · Kapitän"));
    assert.ok(within(frueher).getByText("Ausgetragen seit 14.03.2026"));
    assert.equal(within(frueher).queryAllByText("Nachnominiert").length, 0, "a squad left mid-season still reads as entered late");
    // The line as a whole: its empty facts sit in their own grade, so the words span several elements.
    assert.ok(
      within(frueher).getByText(
        (_, element) => element?.tagName === "P" && element.textContent === "Nummer nicht hinterlegt · Position nicht hinterlegt",
      ),
    );
    for (const leer of ["Nummer nicht hinterlegt", "Position nicht hinterlegt"]) {
      const grade: readonly string[] = within(frueher).getByText(leer).className.split(" ");
      assert.ok(
        grade.includes("text-foreground-muted") && !grade.includes("italic"),
        `„${leer}“ is not in the empty grade: ${grade.join(" ")}`,
      );
    }
  });

  /* The stamped wording names the account page as the place a consent is changed, so this page offers
     no control of its own and sends the reader there. */
  it("offers no consent control and links the account page", () => {
    renderView();

    assert.equal(screen.queryAllByRole("switch").length + screen.queryAllByRole("radiogroup").length, 0);
    assert.equal(screen.getByRole("link", { name: "Konto" }).getAttribute("href"), "/bereich/konto");
  });

  it("leaves the squad section out for a pupil in no squad", () => {
    renderView({ ...SPIELERIN, kader: [] });

    assert.equal(screen.queryAllByRole("heading", { level: 3 }).length, 0);
    assert.equal(screen.queryAllByRole("listitem").length, 0);
  });
});
