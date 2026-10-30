"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy";
import { spielortePostSpielort } from "@/core/generated/client/sdk";
import { SpielortePostSpielortBody } from "@/core/generated/zod/inputs";

const { shape } = SpielortePostSpielortBody;
const adresse = shape.address.shape;

// Digits alone make a price; anything else stays text, which the price's own schema refuses.
const preis = z.preprocess((wert) => (typeof wert === "string" && /^\d+$/.test(wert) ? Number(wert) : wert), shape.default_mietpreis);

/** The create dialog's boxes, by the names they post under, each held to the create's own published rule. */
const SpielortFormular = z.object({
  name: shape.name,
  strasse: adresse.strasse,
  hausnummer: adresse.hausnummer,
  plz: adresse.plz,
  stadtteil: adresse.stadtteil,
  stadt: adresse.stadt,
  mietpreis: preis,
});

/**
 * Creates a venue from the create dialog's boxes. The tag's clearing renders the page again, so the list behind
 * the dialog, or the match editor's venue choice, reads the new venue at once. A name another venue holds is
 * refused on the name's box; the dialog stays open with its input kept.
 */
export const spielortAnlegen = action({
  lane: "admin",
  name: "spielortAnlegen",
  input: SpielortFormular,
  ownWords: { duplicate_key: "name" },
  examples: {
    plz: COPY.verwaltung.spielort.plzBeispiel,
    hausnummer: COPY.verwaltung.spielort.hausnummerBeispiel,
    mietpreis: COPY.verwaltung.spielort.mietpreisBeispiel,
  },
  run: async ({ mietpreis, name, ...address }) => {
    await spielortePostSpielort({ name, default_mietpreis: mietpreis, address });
    return { ok: true, value: undefined };
  },
});
