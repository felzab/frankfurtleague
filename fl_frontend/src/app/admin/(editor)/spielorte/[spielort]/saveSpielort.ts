"use server";

import { z } from "zod";

import { action, numberBox } from "@/core/action";
import { COPY } from "@/core/copy";
import { spielortePatchSpielort } from "@/core/generated/client/sdk";
import { SpielortePatchSpielortBody, SpielortePatchSpielortParams } from "@/core/generated/zod/inputs";
import { getSpielort } from "@/features/spielorte/queries";

import { valuesOf } from "./spielortValues";

import type { ActionAnswer } from "@/core/action";

const { shape } = SpielortePatchSpielortBody;
const address = shape.address.shape;

/** What the editor's boxes send, each held to the venue write's own published rule for it. */
const SaveSpielort = z.object({
  id: SpielortePatchSpielortParams.shape.spielort_id,
  version: shape.version,
  changes: z
    .object({
      name: shape.name,
      street: address.street,
      house_number: address.house_number,
      postcode: address.postcode,
      district: address.district,
      city: address.city,
      mietpreis: numberBox(shape.default_mietpreis),
    })
    .partial(),
});

/**
 * Saves the venue editor's changes on the version the editor was read at, answering the version stored, which the
 * editor takes as its own. The write replaces the whole record, so every field left alone is sent as it is stored,
 * read again here; a venue changed since is refused as stale (`version_stale`) rather than written over. A name another
 * venue holds is refused on the name's box.
 */
export const saveSpielort = action({
  lane: "admin",
  name: "saveSpielort",
  input: SaveSpielort,
  ownWords: ["duplicate_key"],
  paths: { name: "changes.name" },
  examples: {
    "changes.postcode": COPY.admin.spielort.postcodeExample,
    "changes.house_number": COPY.admin.spielort.houseNumberExample,
    "changes.mietpreis": COPY.admin.spielort.mietpreisExample,
  },
  run: async ({ id, version, changes }): Promise<ActionAnswer<number>> => {
    const stored = await getSpielort(id);
    if (stored === null) return { ok: false, reason: COPY.shared.failure.stale };

    const { mietpreis, ...text } = changes;
    const { name, street, house_number, postcode, district, city } = { ...valuesOf(stored), ...text };
    const written = await spielortePatchSpielort(id, {
      name,
      // The stored figure where the price was left alone, never the text the editor shows it as.
      default_mietpreis: mietpreis ?? stored.default_mietpreis,
      address: { street, house_number, postcode, district, city },
      version,
    });
    return { ok: true, value: written.version };
  },
});
