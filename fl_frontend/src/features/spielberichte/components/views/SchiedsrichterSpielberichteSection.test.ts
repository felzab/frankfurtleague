import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";

import { underNext } from "@/shared/testing/nextContexts.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SchiedsrichterSpielberichteSection } = await import("./SchiedsrichterSpielberichteSection.tsx");

const eintrag = (spiel_id: string, datum: string) => ({
  spiel_id,
  datum,
  uhrzeit: "15:00:00",
  team1_name: "Goethe-Gymnasium",
  team2_name: "Lessing-Gymnasium",
  eingereicht_am: null,
});

describe("the referee panel's reports", () => {
  /* One pairing meets in its group and again in a knockout round: a link named by the pairing alone names two cards
     alike, which speech input cannot tell apart (WCAG 2.5.3). */
  it("names each card's link by its pairing and its date", () => {
    render(
      underNext(
        h(SchiedsrichterSpielberichteSection, {
          spiele: [eintrag("68c1f0a2b3c4d5e6f7a8b9e2", "2026-10-17"), eintrag("68c1f0a2b3c4d5e6f7a8b9e3", "2026-11-14")],
        }),
      ),
    );

    const namen = screen.getAllByRole("link").map((link) => link.getAttribute("aria-label") ?? "");
    assert.equal(new Set(namen).size, 2, `two cards share a link name: ${namen.join(" | ")}`);
    assert.ok(
      namen.every((name) => name.startsWith("Spielbericht eintragen") && / am \d{2}\.\d{2}\.\d{4}$/.test(name)),
      namen.join(" | "),
    );
  });
});
