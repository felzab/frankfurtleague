import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { registerDoubles } from "@/core/exportingModule.ts";
import { spielFields } from "@/shared/testing/fixtures.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";
import { spielberichtReadFixture } from "@/shared/testing/spielberichtFixtures.ts";

/** The props each render handed the match editor's form. */
const handed: Record<string, unknown>[] = [];

/* The form, replaced at the module boundary: its own sheets hand it these props directly, so only a double here sees
   what the view hands it. */
registerDoubles({
  modules: {
    "features/spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm.tsx": {
      AdminEditSpielDataForm: (props: Record<string, unknown>) => {
        handed.push(props);
        return null;
      },
    },
  },
});

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminSpielEditView } = await import("./AdminSpielEditView.tsx");
const { AdminProvider } = await import("../providers/AdminContextProvider.tsx");
const { FLSpielAdminSchema } = await import("@/features/spiele/schemas.ts");

const { FLSpielberichtAdminResponseSchema } = await import("@/features/spielberichte/schemas.ts");

const SPIEL = FLSpielAdminSchema.parse(spielFields());
const SPIELBERICHT = { lesen: FLSpielberichtAdminResponseSchema.parse(spielberichtReadFixture()), korrigierbar: true };

/* The type holds each prop present, never where its value comes from: a literal or the neighbouring boolean in its
   place passes tsc and every sheet of the form, and warns of a pass that never runs. */
describe("what the match editor's view hands its form", () => {
  for (const [isSpielSweepOn, isActiveSaison, today, bestaetigungen, spielbericht] of [
    [true, false, "2026-05-01", null, SPIELBERICHT],
    [false, true, "2026-06-02", { zeilen: [], gelaufenAm: "2026-06-01" }, null],
  ] as const) {
    it(`hands the pass as ${isSpielSweepOn ? "on" : "off"}, the season as ${isActiveSaison ? "running" : "not running"}, the day, the confirmations and the report as given`, () => {
      handed.length = 0;

      renderTree(
        h(AdminProvider, {
          spielorte: [],
          schiedsrichter: [],
          teams: [],
          saisonSpiele: [],
          numberOfGroups: null,
          isFinishedSaison: false,
          isActiveSaison: isActiveSaison,
          children: h(AdminSpielEditView, {
            spielData: SPIEL,
            today: today,
            isSpielSweepOn: isSpielSweepOn,
            bestaetigungen: bestaetigungen,
            spielbericht: spielbericht,
          }),
        }),
      );

      assert.deepEqual(
        handed.map((props) => [
          props["isSpielSweepOn"],
          props["isActiveSaison"],
          props["today"],
          props["bestaetigungen"],
          props["spielbericht"],
        ]),
        [[isSpielSweepOn, isActiveSaison, today, bestaetigungen, spielbericht]],
      );
    });
  }
});
