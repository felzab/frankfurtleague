"use server";

import { z } from "zod";

import { action, numberBox } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { spielortePostSpielort } from "@/core/generated/client/sdk";
import { SpielortePostSpielortBody } from "@/core/generated/zod/inputs";

const { shape } = SpielortePostSpielortBody;
const address = shape.address.shape;

const CreateSpielortForm = z.object({
  name: shape.name,
  street: address.street,
  house_number: address.house_number,
  postcode: address.postcode,
  district: address.district,
  city: address.city,
  default_mietpreis: numberBox(shape.default_mietpreis),
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
  boxes: ["name"],
  examples: {
    postcode: COPY.shared.address.postcodeExample,
    house_number: COPY.shared.address.houseNumberExample,
    default_mietpreis: ADMIN_COPY.spielort.mietpreisExample,
  },
  run: async ({ default_mietpreis, name, ...address }) => {
    await spielortePostSpielort({ name, default_mietpreis, address });
    return { ok: true, value: undefined };
  },
});
