"use server";

import { z } from "zod";

import { action, blankIsNull, fault } from "@/core/action";
import { COPY } from "@/core/copy/shared";
import { spielerPatchSpielerSaison } from "@/core/generated/client/sdk";
import { SpielerPatchSpielerSaisonBody, SpielerPatchSpielerSaisonParams } from "@/core/generated/zod/inputs";
import { getSpielerSaison } from "@/features/spieler/queries";

import { requiredOf, valuesOf } from "./spielerValues";

import type { LaneAnswer } from "@/core/action";

const { shape } = SpielerPatchSpielerSaisonBody;

/**
 * What the editor's boxes send, each held to the write's own published rule for it: an empty box but the forename's is
 * no value. A birthdate emptied sends no day, which the write cannot take: refused below on its box (`requiredOf`).
 */
const SaveSpieler = z.object({
  id: SpielerPatchSpielerSaisonParams.shape.spieler_id,
  saison: SpielerPatchSpielerSaisonParams.shape.saison_id,
  // The sum of the person's and the row's versions as the editor read them.
  version: shape.version,
  changes: z
    .object({
      first_name: shape.first_name,
      last_name: blankIsNull(shape.last_name),
      birth_date: z.union([shape.birth_date, z.null()]),
      nummer: blankIsNull(shape.nummer),
      position: blankIsNull(shape.position),
      stufe: blankIsNull(shape.stufe),
      rolle: blankIsNull(shape.rolle),
    })
    .partial(),
});

/**
 * Saves the Spieler editor's changes on the version the editor was read at, answering the version stored. The write
 * replaces the person's facts and the row's whole, in one transaction, so every field left alone is sent as stored,
 * read again here. A role another row took since the page was read is refused on the role's box; a Stufe the season
 * stopped offering and a person or row moved since are a stale page.
 */
export const saveSpieler = action({
  lane: "admin",
  name: "saveSpieler",
  input: SaveSpieler,
  examples: {
    "changes.first_name": COPY.shared.field.exampleFirstName,
    "changes.last_name": COPY.shared.field.exampleLastName,
    "changes.nummer": COPY.shared.field.exampleDigits,
  },
  run: async ({ id, saison, version, changes }): Promise<LaneAnswer<number>> => {
    const read = await getSpielerSaison(id, saison);
    if (read === null) return { ok: false, reason: COPY.shared.failure.stale };

    const stored = valuesOf(read);
    const merged = { ...stored, ...changes };
    const { first_name, birth_date } = merged;
    if (birth_date === null) return { ok: false, faults: requiredOf(merged).map((box) => fault(`changes.${box}`, "required")) };

    const { kader, person } = read;
    const written = await spielerPatchSpielerSaison(id, saison, {
      first_name,
      last_name: changes.last_name === undefined ? person.last_name : changes.last_name,
      birth_date,
      nummer: changes.nummer === undefined ? kader.nummer : changes.nummer,
      position: changes.position === undefined ? kader.position : changes.position,
      stufe: changes.stufe === undefined ? kader.stufe : changes.stufe,
      rolle: changes.rolle === undefined ? kader.rolle : changes.rolle,
      version,
    });
    return { ok: true, value: written.version };
  },
});
