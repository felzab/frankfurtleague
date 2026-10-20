import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { spielbestaetigungFields, spielFields } from "@/shared/testing/fixtures.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { FLSpielbestaetigung } from "@/features/spielbestaetigungen/schemas.ts";
import type { FLSpiel } from "../../schemas.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { SpielCardsList } = await import("./SpielCardsList.tsx");
const { FLSpielSchema } = await import("../../schemas.ts");
const { FLSpielbestaetigungSchema } = await import("@/features/spielbestaetigungen/schemas.ts");

const SCHIEDSRICHTER = "6890a1b2c3d4e5f607182935";
const SPIEL = FLSpielSchema.parse(
  spielFields({
    datum: "2026-08-05",
    uhrzeit: "18:00:00",
    schiedsrichter: { schiedsrichter_id: SCHIEDSRICHTER, name: "Rita Rot", name_is_public: true },
  }),
);
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
      partei: { art: "schiedsrichter", schiedsrichter_id: SCHIEDSRICHTER },
      kontakte: null,
      antwort: { art: "zugesagt", am: "2026-07-28", von: { art: "schiedsrichter" }, vorschlag: null, begruendung: null },
    }),
  ),
];

const list = (isAdmin: boolean, zeilen: readonly FLSpielbestaetigung[] = ZEILEN, spiel: FLSpiel = SPIEL): string =>
  textOf(
    renderTree(
      underNext(
        h(SpielCardsList, {
          spiele: [spiel],
          today: "2026-07-30",
          isFinishedSaison: false,
          isAdmin,
          bestaetigungen: { bySpielId: new Map([[spiel.id, zeilen]]), austritte: new Map() },
        }),
      ),
    ),
    // No separator: a chip spells its name and its answer in two spans, read as one line.
    "",
  );

describe("the answer chips on a fixture's card", () => {
  it("name each party's answer on the admin card, in the card's order", () => {
    const text = list(true);

    assert.ok(/Team A: Abgelehnt.*Team B: Offen.*Schiedsrichter: Zugesagt/.test(text), `the admin card's chips read „${text}“`);
  });

  // The previous referee's row stays open until the next pass closes it, and read as current it would answer for the
  // referee booked since.
  it("read no answer of a referee other than the one the fixture books", () => {
    const umbesetzt = { ...SPIEL, schiedsrichter: { schiedsrichter_id: "6890a1b2c3d4e5f607182936", name: "Udo Neu", name_is_public: true } };

    assert.doesNotMatch(list(true, ZEILEN, umbesetzt), /Schiedsrichter:/);
  });

  // The league kept the date: the public card counts the discard as the club's agreement, so the chip says so.
  it("say a discarded proposal was discarded rather than dropping the club's chip", () => {
    const verworfen = FLSpielbestaetigungSchema.parse({ ...ZEILEN[0], geschlossen: { am: "2026-07-29", grund: "verworfen" } });

    assert.match(list(true, [verworfen]), /Team A: Verworfen/);
  });

  // The decline closes its own row, so the chip reads it past the current rows while the slot it emptied stays empty.
  it("keep a referee's own decline on the admin card while the slot stays empty", () => {
    const leer = { ...SPIEL, schiedsrichter: null };
    const abgelehnt = FLSpielbestaetigungSchema.parse(
      spielbestaetigungFields({
        id: "6890a1b2c3d4e5f607182a04",
        partei: { art: "schiedsrichter", schiedsrichter_id: SCHIEDSRICHTER },
        kontakte: null,
        antwort: { art: "abgelehnt", am: "2026-07-28", von: { art: "schiedsrichter" }, vorschlag: null, begruendung: "Krank" },
        geschlossen: { am: "2026-07-28", grund: "schiedsrichter_abgelehnt" },
      }),
    );

    assert.match(list(true, [abgelehnt], leer), /Schiedsrichter: Abgelehnt/);
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
