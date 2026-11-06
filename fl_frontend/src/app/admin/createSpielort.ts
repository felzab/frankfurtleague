"use server";

import { z } from "zod";

import { action, numberBox } from "@/core/action";
import { COPY } from "@/core/copy";
import { spielortePostSpielort } from "@/core/generated/client/sdk";
import { SpielortePostSpielortBody } from "@/core/generated/zod/inputs";

const { shape } = SpielortePostSpielortBody;
const address = shape.address.shape;

/** The create dialog's boxes, by the names they post under, each held to the create's own published rule. */
const CreateSpielortForm = z.object({
  name: shape.name,
  street: address.street,
  house_number: address.house_number,
  postcode: address.postcode,
  district: address.district,
  city: address.city,
  mietpreis: numberBox(shape.default_mietpreis),
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
    postcode: COPY.admin.spielort.postcodeExample,
    house_number: COPY.admin.spielort.houseNumberExample,
    mietpreis: COPY.admin.spielort.mietpreisExample,
  },
  run: async ({ mietpreis, name, ...address }) => {
    await spielortePostSpielort({ name, default_mietpreis: mietpreis, address });
    return { ok: true, value: undefined };
  },
});
