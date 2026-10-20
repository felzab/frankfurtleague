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
        istEingesetzt: false,
        hatEntwurf: props.hatEntwurf ?? false,
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
