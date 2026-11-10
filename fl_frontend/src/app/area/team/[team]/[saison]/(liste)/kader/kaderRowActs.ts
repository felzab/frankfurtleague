"use server";

import { z } from "zod";

import { action, blankIsNull, numberBox } from "@/core/action";
import { COPY } from "@/core/copy";
import { SpielerDeleteKaderRowParams, SpielerPatchKaderRowBody, SpielerPatchKaderRowParams } from "@/core/generated/zod/inputs";
import { deleteKaderRow, patchKaderRow } from "@/features/spieler/mutations";

const { shape } = SpielerPatchKaderRowBody;

/**
 * Saves a squad row's four values from its dialog, on the row's version the page read: the write replaces all four, so
 * the dialog posts each as it stands, an empty box as no value. A role another row took since the page was read is
 * refused on the role's box; a row changed or taken out since, and a Stufe the season stopped offering, are a stale page.
 */
export const saveKaderRow = action({
  lane: "person",
  claim: "seat",
  name: "saveKaderRow",
  input: z.object({
    ...SpielerPatchKaderRowParams.shape,
    nummer: blankIsNull(shape.nummer),
    position: blankIsNull(shape.position),
    stufe: blankIsNull(shape.stufe),
    rolle: blankIsNull(shape.rolle),
    version: numberBox(shape.version),
  }),
  ownWords: ["kader_rolle_taken"],
  paths: { rolle: "rolle" },
  examples: { nummer: COPY.shared.field.exampleDigits },
  run: async ({ team_id, saison_id, spieler_id, ...row }) => {
    await patchKaderRow(team_id, saison_id, spieler_id, row);
    return { ok: true, value: undefined };
  },
});

/**
 * Takes the player out of the squad from the dialog's danger row: the row stays, ausgetragen, and only the league
 * brings it back. A row taken out since the page was read is a stale page.
 */
export const deregisterKaderRow = action({
  lane: "person",
  claim: "seat",
  name: "deregisterKaderRow",
  input: z.object(SpielerDeleteKaderRowParams.shape),
  run: async ({ team_id, saison_id, spieler_id }) => {
    await deleteKaderRow(team_id, saison_id, spieler_id);
    return { ok: true, value: undefined };
  },
});
