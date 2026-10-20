import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { createElement as h } from "react";

import { cleanup, render, screen } from "@testing-library/react";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { spielberichtReadFixture } from "@/shared/testing/spielberichtFixtures.ts";

import type { SpielberichtStand } from "../../types.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminSpielberichtPanel } = await import("./AdminSpielberichtPanel.tsx");
const { FLSpielberichtAdminResponseSchema } = await import("../../schemas.ts");

const stand = (fields: Record<string, unknown> = {}, korrigierbar = true): SpielberichtStand => ({
  lesen: FLSpielberichtAdminResponseSchema.parse(spielberichtReadFixture(fields)),
  korrigierbar,
});

const panel = (props: { stand: SpielberichtStand | null; hatEntwurf?: boolean }) =>
  render(
    underNext(
      h(AdminSpielberichtPanel, {
        stand: props.stand,
        onUebernehmen: () => undefined,
        uebernahmeGesperrt: null,
        eingesetzt: null,
        hatEntwurf: props.hatEntwurf ?? false,
        today: "2026-10-17",
      }),
      { search: "saison_id=2026" },
    ),
  );

const korrekturLinks = () => screen.queryAllByRole("link", { name: "Spielbericht bearbeiten" }).length;

afterEach(cleanup);

describe("the report panel on the match editor", () => {
  /* A failed read and a fixture without a report would otherwise look alike, and the administrator could neither adopt
     nor see why. */
  it("says a failed read failed", () => {
    panel({ stand: null });

    assert.ok(screen.getByText(/Der Spielbericht ließ sich gerade nicht lesen/));
    assert.equal(korrekturLinks(), 0);
  });

  /* Both writes refuse a called-off fixture, so a press offered on it could only be refused. */
  it("offers neither the adoption nor the correction on a report whose fixture was called off", () => {
    panel({ stand: stand({ zustand: "abgesagt", spiel: { ...spielberichtReadFixture().spiel, sonderereignis: "ausgefallen" } }) });

    assert.equal(screen.queryAllByRole("button", { name: /Vorschlag übernehmen/ }).length, 0);
    assert.equal(korrekturLinks(), 0);
    assert.ok(screen.getByText("Abgesagt"));
  });

  /* Written about a club that has left team 2's slot: its score and its entries beside the clubs playing now would
     credit them with what the departed club did. */
  it("names neither the score nor the club now on a moved side of a report about clubs that left", () => {
    panel({ stand: stand({ zustand: "teams_geaendert", seiten_geaendert: ["team2"] }) });

    assert.equal(screen.queryAllByText(/^Vorschlag:/).length, 0, "the score proposed for the departed club is shown");
    assert.equal(screen.queryAllByText("Lessing-Gymnasium").length, 0, "the card is listed under the club now on its side");
    assert.ok(screen.getByText("früheres Team 2"));
  });

  /* The correction page states these fixtures' refusals and offers no form, so a link to it leads nowhere. The state is
     the report's, so a fixture with no report reads none of it: only the fixture says whether it takes one. */
  it("offers no correction on a fixture holding no report that takes none", () => {
    const { spiel } = spielberichtReadFixture();
    for (const fixture of [
      { ...spiel, sonderereignis: "ausgefallen" },
      { ...spiel, datum: "2026-10-18" },
      { ...spiel, datum: null },
    ]) {
      cleanup();
      panel({ stand: stand({ spiel: fixture, bericht: null, zustand: null }) });

      assert.equal(korrekturLinks(), 0, JSON.stringify(fixture));
    }
  });

  /* Closed, the correction page writes nothing, and its sentence would be the closed state's. */
  it("offers no correction while the switch reads off", () => {
    panel({ stand: stand({}, false) });

    assert.equal(korrekturLinks(), 0);
    assert.ok(screen.getByText(/Solange Spielberichte nicht freigeschaltet sind/));
  });

  /* The link is a client-side navigation, which the editor's unsaved-changes guard never sees: a seeded draft would go
     unasked. */
  it("holds the correction back while the editor holds unsaved changes, and says why", () => {
    panel({ stand: stand(), hatEntwurf: true });

    assert.equal(korrekturLinks(), 0);
    assert.ok(screen.getAllByText(/Speichere oder verwirf zuerst Deine Änderungen am Spiel/).length > 0);
  });

  it("links to the correction on a clean editor while the switch reads on", () => {
    panel({ stand: stand() });

    assert.equal(korrekturLinks(), 1);
  });
});
