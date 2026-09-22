import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { doubleActions } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { FLSperrlisteEintrag } from "@/features/sperrliste/schemas.ts";

/** The removal each row offers: a real one needs a session and a backend. */
doubleActions({ modules: ["/src/features/sperrliste/actions.ts"] });

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { AdminSperrlisteView } = await import("./AdminSperrlisteView.tsx");

const SPERREN: FLSperrlisteEintrag[] = [
  {
    id: "6890a1b2c3d4e5f607190001",
    grund: "Falsches Geburtsdatum angegeben",
    erstellt_von: "vorstand@example.org",
    erstellt_am: "2026-03-12",
    gesperrt_bis_saison_id: "2031",
  },
  {
    id: "6890a1b2c3d4e5f607190002",
    grund: "Wiederholt fremde Namen eingetragen",
    erstellt_von: "turnier@example.org",
    erstellt_am: "2026-04-02",
    gesperrt_bis_saison_id: "2032",
  },
];

const viewText = (anzahlGesamt: number): string =>
  textOf(
    renderTree(underNext(h(AdminSperrlisteView, { sperrliste: SPERREN, anzahlGesamt: anzahlGesamt }), { pathname: "/admin/sperrliste" })),
    " ",
  )
    .replace(/\s+/g, " ")
    .trim();

describe("what the ban list says about its own completeness", () => {
  /* Past the endpoint's cap a ban is enforced and shown to nobody, and a ban nobody can see is a
     person barred by a row nobody can lift. */
  it("says so where the collection holds more bans than it served", () => {
    const text = viewText(SPERREN.length + 1509);

    assert.match(text, /Diese Liste ist unvollständig/, "a capped answer renders as a whole list");
    assert.match(text, /Gesperrt sind 1511 Adressen, geladen sind die 2 neuesten\./, "the note names other numbers than the answer's");
    assert.match(text, /lassen sich hier nicht aufheben/, "the note leaves the hidden rows looking liftable");
    assert.match(text, /Auch die Suche erfasst nur die geladenen Sperren\./, "the note lets the bar read as reaching every ban");
  });

  /* The other half: a standing warning over a whole list is a false alarm, and one that never
     disappears is one nobody reads. */
  it("says nothing where the answer carries every ban", () => {
    const text = viewText(SPERREN.length);

    assert.doesNotMatch(text, /unvollständig/, "a whole list announces itself as cut short");
    assert.match(text, /Falsches Geburtsdatum angegeben/, "the view renders no row, so the absence above proves nothing");
  });
});
