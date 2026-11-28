"use server";

import { z } from "zod";

import { action, blankIsNull, numberBox, PAGE_HOLDER } from "@/core/action";
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
  ...PAGE_HOLDER,
});

/**
 * Enters a referee from the create dialog over the list, which is asking them, behind its dry run and the passkey
 * touch: the backend owes the person their confirmation link at once, through the outbox, and the answer names the
 * address it goes to. A name another referee holds, a retired one's included, is refused on the name's box, and an
 * address the backend cannot mail on the address's, by the dry run before the touch, the dialog staying open with its
 * input kept.
 */
export const createSchiedsrichter = action({
  lane: "admin",
  passkey: true,
  dryRun: true,
  name: "createSchiedsrichter",
  input: SchiedsrichterForm,
  boxes: ["name"],
  paths: { "kontakt.email": "email" },
  examples: { name: COPY.shared.field.exampleName, phone: COPY.shared.field.examplePhone },
  run: async ({ name, email, phone, schule, default_payment }, { dryRun }) => {
    const created = await schiedsrichterPostSchiedsrichter({ name, kontakt: { email, phone }, schule, default_payment }, { dry_run: dryRun });
    // A passing dry run answers 204, which the client reads as no body: nothing was created to name.
    if (!created) return { ok: true, value: undefined };
    // The mailbox as the backend stores and mails it, so the note spells it as the editor later shows it.
    return { ok: true, value: undefined, note: ADMIN_COPY.schiedsrichter.sentTo(created.confirmation.email) };
  },
});
