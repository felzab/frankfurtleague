"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy";
import { spielortePostSpielort } from "@/core/generated/client/sdk";
import { SpielortePostSpielortBody } from "@/core/generated/zod/inputs";

const { shape } = SpielortePostSpielortBody;
const address = shape.address.shape;

// Digits alone make a price; anything else stays text, which the price's own schema refuses.
const price = z.preprocess((value) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value), shape.default_mietpreis);

/** The create dialog's boxes, by the names they post under, each held to the create's own published rule. */
const CreateSpielortForm = z.object({
  name: shape.name,
  strasse: address.strasse,
  hausnummer: address.hausnummer,
  plz: address.plz,
  stadtteil: address.stadtteil,
  stadt: address.stadt,
  mietpreis: price,
});

/**
 * Creates a venue from the create dialog's boxes. The tag's clearing renders the page again, so the list behind
 * the dialog, or the match editor's venue choice, reads the new venue at once. A name another venue holds is
 * refused on the name's box; the dialog stays open with its input kept.
 */
export const createSpielort = action({
  lane: "admin",
  name: "createSpielort",
  input: CreateSpielortForm,
  ownWords: ["duplicate_key"],
  paths: { name: "name" },
  examples: {
    plz: COPY.admin.spielort.plzExample,
    hausnummer: COPY.admin.spielort.hausnummerExample,
    mietpreis: COPY.admin.spielort.mietpreisExample,
  },
  run: async ({ mietpreis, name, ...address }) => {
    await spielortePostSpielort({ name, default_mietpreis: mietpreis, address });
    return { ok: true, value: undefined };
  },
});
