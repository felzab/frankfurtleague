"use server";

import { z } from "zod";

import { action, blankIsNull, numberBox } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { schiedsrichterPostSchiedsrichter } from "@/core/generated/client/sdk";
import { SchiedsrichterPostSchiedsrichterBody } from "@/core/generated/zod/inputs";

const { shape } = SchiedsrichterPostSchiedsrichterBody;
const kontakt = shape.kontakt.shape;

/**
 * The create dialog's boxes, by the names they post under, each held to the create's own published rule: an empty box
 * but the name's is no value.
 */
const SchiedsrichterForm = z.object({
  name: shape.name,
  email: blankIsNull(kontakt.email),
  phone: blankIsNull(kontakt.phone),
  schule: blankIsNull(shape.schule),
  default_payment: numberBox(shape.default_payment),
});

/**
 * Enters a referee from the create dialog over the list, which is asking them: the backend owes the person their
 * confirmation link at once, through the outbox, and the answer names the address it goes to. A name another referee
 * holds, a retired one's included, is refused on the name's box, and an address the backend cannot mail on the
 * address's, the dialog staying open with its input kept.
 */
export const createSchiedsrichter = action({
  lane: "admin",
  name: "createSchiedsrichter",
  input: SchiedsrichterForm,
  boxes: ["name"],
  paths: { "kontakt.email": "email" },
  examples: { name: COPY.shared.field.exampleName, phone: COPY.shared.field.examplePhone },
  run: async ({ name, email, phone, schule, default_payment }) => {
    await schiedsrichterPostSchiedsrichter({ name, kontakt: { email, phone }, schule, default_payment });
    // The mailbox posted is the one the create's own transaction writes and owes the link to, named as it was typed.
    return { ok: true, value: undefined, note: ADMIN_COPY.schiedsrichter.sentTo(email) };
  },
});
