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
          spiele: {
            spiele: [eintrag("68c1f0a2b3c4d5e6f7a8b9e2", "2026-10-17"), eintrag("68c1f0a2b3c4d5e6f7a8b9e3", "2026-11-14")],
            fruehere: [],
          },
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

  /* After its season a report is only read, and nothing else leads to that view: the ended seasons' reports are listed
     apart, each opening its fixture's page, which shows the report read-only. */
  it("lists an ended season's report apart, to be read, beside a running season with nothing due", () => {
    const frueher = { ...eintrag("68c1f0a2b3c4d5e6f7a8b9e4", "2025-05-14"), eingereicht_am: "2025-05-14T18:00:00Z" };
    render(underNext(h(SchiedsrichterSpielberichteSection, { spiele: { spiele: [], fruehere: [frueher] } })));

    assert.ok(screen.getByText("Gerade steht kein Spiel für einen Spielbericht an."));
    const liste = screen.getByRole("list", { name: "Spielberichte früherer Saisons" });
    assert.equal(liste.previousElementSibling?.textContent, "Frühere Saisons");
    assert.equal(
      screen.getByRole("link", { name: "Spielbericht ansehen: Goethe-Gymnasium gegen Lessing-Gymnasium am 14.05.2025" }).getAttribute("href"),
      "/bereich/schiedsrichter/spielbericht/68c1f0a2b3c4d5e6f7a8b9e4",
    );
    assert.equal(screen.queryAllByText(/^(Gespeichert|Offen)$/).length, 0, "an ended season's report wears the running season's badge");
  });

  /* The first write may be the league's, which the referee never sent: the badge names the report saved, the save's own
     word, and „Offen“ where none stands. */
  it("marks a running season's stored report saved and one still due open", () => {
    render(
      underNext(
        h(SchiedsrichterSpielberichteSection, {
          spiele: {
            spiele: [
              { ...eintrag("68c1f0a2b3c4d5e6f7a8b9e6", "2026-10-17"), eingereicht_am: "2026-10-17T18:00:00Z" },
              eintrag("68c1f0a2b3c4d5e6f7a8b9e7", "2026-10-18"),
            ],
            fruehere: [],
          },
        }),
      ),
    );

    assert.deepEqual(
      screen.getAllByText(/^(Gespeichert|Offen|Gesendet)$/).map((badge) => badge.textContent),
      ["Gespeichert", "Offen"],
    );
  });

  /* A date cleared after the report leaves the report standing, so its card stays and says the date is missing. */
  it("lists an ended season's report whose date was cleared, saying the date is missing", () => {
    const frueher = { ...eintrag("68c1f0a2b3c4d5e6f7a8b9e5", "2025-05-14"), datum: null, eingereicht_am: "2025-05-14T18:00:00Z" };
    render(underNext(h(SchiedsrichterSpielberichteSection, { spiele: { spiele: [], fruehere: [frueher] } })));

    assert.ok(screen.getByText("Termin nicht hinterlegt, 15:00 Uhr"));
    assert.ok(screen.getByRole("link", { name: "Spielbericht ansehen: Goethe-Gymnasium gegen Lessing-Gymnasium, Termin nicht hinterlegt" }));
  });
});
