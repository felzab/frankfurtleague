import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { spielbestaetigungFields, spielFields } from "@/shared/testing/fixtures.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { FLSpielbestaetigung } from "@/features/spielbestaetigungen/schemas.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SpielCardsList } = await import("./SpielCardsList.tsx");
const { FLSpielSchema } = await import("../../schemas.ts");
const { FLSpielbestaetigungSchema } = await import("@/features/spielbestaetigungen/schemas.ts");

const SPIEL = FLSpielSchema.parse(spielFields({ datum: "2026-08-05", uhrzeit: "18:00:00" }));
const ZEILEN = [
  FLSpielbestaetigungSchema.parse(
    spielbestaetigungFields({
      antwort: {
        art: "abgelehnt",
        am: "2026-07-28",
        von: { art: "kontakt", rolle: "trainer" },
        vorschlag: { datum: "2026-08-07", uhrzeit: "17:00:00" },
        begruendung: null,
      },
    }),
  ),
  FLSpielbestaetigungSchema.parse(
    spielbestaetigungFields({
      id: "6890a1b2c3d4e5f607182a02",
      partei: { art: "team", team_id: "6890a1b2c3d4e5f607182933" },
      frist: "2026-07-31",
    }),
  ),
  FLSpielbestaetigungSchema.parse(
    spielbestaetigungFields({
      id: "6890a1b2c3d4e5f607182a03",
      partei: { art: "schiedsrichter", schiedsrichter_id: "6890a1b2c3d4e5f607182935" },
      kontakte: null,
      antwort: { art: "zugesagt", am: "2026-07-28", von: { art: "schiedsrichter" }, vorschlag: null, begruendung: null },
    }),
  ),
];

const list = (isAdmin: boolean, zeilen: readonly FLSpielbestaetigung[] = ZEILEN): string =>
  textOf(
    renderTree(
      underNext(
        h(SpielCardsList, {
          spiele: [SPIEL],
          today: "2026-07-30",
          isFinishedSaison: false,
          isAdmin,
          bestaetigungenBySpielId: new Map([[SPIEL.id, zeilen]]),
        }),
      ),
    ),
    " ",
  );

describe("the answer chips on a fixture's card", () => {
  it("name each party's answer on the admin card, in the card's order", () => {
    const text = list(true);

    assert.ok(/Team A: Abgelehnt.*Team B: Offen.*Schiedsrichter: Zugesagt/.test(text), `the admin card's chips read „${text}“`);
  });

  // The decline closes its own row, so the chip reads it past the current rows while the slot it emptied stays empty.
  it("keep a referee's own decline on the admin card while the slot stays empty", () => {
    const abgelehnt = FLSpielbestaetigungSchema.parse(
      spielbestaetigungFields({
        id: "6890a1b2c3d4e5f607182a04",
        partei: { art: "schiedsrichter", schiedsrichter_id: "6890a1b2c3d4e5f607182935" },
        kontakte: null,
        antwort: { art: "abgelehnt", am: "2026-07-28", von: { art: "schiedsrichter" }, vorschlag: null, begruendung: "Krank" },
        geschlossen: { am: "2026-07-28", grund: "schiedsrichter_abgelehnt" },
      }),
    );

    assert.match(list(true, [abgelehnt]), /Schiedsrichter: Abgelehnt/);
  });

  /* The rows are an administrator's read: a public list handed them by mistake must still draw a public card. */
  it("stay off a public card even where its caller passes the rows", () => {
    const text = list(false);

    assert.doesNotMatch(text, /Abgelehnt|Zugesagt|Offen/);
  });
});

describe("the report chip on a fixture's card", () => {
  const mitChip = (isAdmin: boolean): string =>
    textOf(
      renderTree(
        underNext(
          h(SpielCardsList, {
            spiele: [SPIEL],
            today: "2026-07-30",
            isFinishedSaison: false,
            isAdmin,
            berichtChipsBySpielId: new Map([[SPIEL.id, { text: "Ergebnis vorgeschlagen 3:1", tone: "info" as const }]]),
          }),
        ),
      ),
      " ",
    );

  /* The proposed result is withheld from the public tier, so the chip is keyed on the edit link as the answers are. */
  it("stays off a public card even where its caller passes the chips, and shows on the admin card", () => {
    assert.doesNotMatch(mitChip(false), /Ergebnis vorgeschlagen/);
    assert.match(mitChip(true), /Ergebnis vorgeschlagen 3:1/);
  });
});
