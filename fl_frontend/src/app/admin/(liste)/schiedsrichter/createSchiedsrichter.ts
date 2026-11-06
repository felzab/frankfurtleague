"use server";

import { z } from "zod";

import { action, blankIsNull, numberBox } from "@/core/action";
import { COPY } from "@/core/copy";
import { schiedsrichterPostSchiedsrichter } from "@/core/generated/client/sdk";
import { SchiedsrichterPostSchiedsrichterBody } from "@/core/generated/zod/inputs";

const { shape } = SchiedsrichterPostSchiedsrichterBody;
const kontakt = shape.kontakt.shape;

/**
 * The create dialog's boxes, by the names they post under, each held to the create's own published rule: an empty box
 * but the name's is no value, as `fieldRules.ts` marks them.
 */
const SchiedsrichterForm = z.object({
  name: shape.name,
  email: blankIsNull(kontakt.email),
  phone: blankIsNull(kontakt.phone),
  schule: blankIsNull(shape.schule),
  payment: numberBox(shape.default_payment),
});

/**
 * Enters a referee from the create dialog over the list, which is asking them: the backend owes the person their
 * confirmation link at once, through the outbox. A name another referee holds, a retired one's included, is refused on
 * the name's box, and an address the backend cannot mail or the ban list holds on the address's or the status line, the
 * dialog staying open with its input kept.
 */
export const createSchiedsrichter = action({
  lane: "admin",
  name: "createSchiedsrichter",
  input: SchiedsrichterForm,
  ownWords: ["duplicate_key", "email_not_accepted", "schiedsrichter_address_barred"],
  paths: { name: "name", "kontakt.email": "email" },
  examples: { phone: COPY.admin.schiedsrichter.phoneExample },
  run: async ({ name, email, phone, schule, payment }) => {
    await schiedsrichterPostSchiedsrichter({ name, kontakt: { email, phone }, schule, default_payment: payment });
    return { ok: true, value: undefined };
  },
});
