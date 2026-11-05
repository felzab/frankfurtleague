"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy";
import { schiedsrichterPostSchiedsrichter } from "@/core/generated/client/sdk";
import { SchiedsrichterPostSchiedsrichterBody } from "@/core/generated/zod/inputs";

const { shape } = SchiedsrichterPostSchiedsrichterBody;
const kontakt = shape.kontakt.shape;

// An empty box is no value; digits alone make a fee, anything else stays text, which the fee's own schema refuses.
const orNull = (value: unknown) => (value === "" ? null : value);
const fee = z.preprocess((value) => (typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value), shape.default_payment);

/** The create dialog's boxes, by the names they post under, each held to the create's own published rule. */
const SchiedsrichterForm = z.object({
  name: shape.name,
  email: kontakt.email,
  telefon: z.preprocess(orNull, kontakt.telefon),
  schule: z.preprocess(orNull, shape.schule),
  honorar: fee,
});

/**
 * Enters a referee from the create dialog over the list, which is asking them: the backend owes the person their
 * confirmation link at once, through the outbox, as the dialog's line under the address says. An address the backend
 * cannot mail or the ban list holds is refused, the dialog staying open with its input kept.
 */
export const createSchiedsrichter = action({
  lane: "admin",
  name: "createSchiedsrichter",
  input: SchiedsrichterForm,
  ownWords: ["email_not_accepted", "schiedsrichter_address_barred"],
  paths: { "kontakt.email": "email" },
  examples: { telefon: COPY.admin.schiedsrichter.telefonExample },
  run: async ({ name, email, telefon, schule, honorar }) => {
    await schiedsrichterPostSchiedsrichter({ name, kontakt: { email, telefon }, schule, default_payment: honorar });
    return { ok: true, value: undefined };
  },
});
