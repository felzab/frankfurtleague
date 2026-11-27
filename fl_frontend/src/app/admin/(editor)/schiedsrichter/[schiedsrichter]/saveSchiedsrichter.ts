"use server";

import { z } from "zod";

import { action, blankIsNull, numberBox, PAGE_HOLDER } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { schiedsrichterPatchSchiedsrichter } from "@/core/generated/client/sdk";
import { SchiedsrichterPatchSchiedsrichterBody, SchiedsrichterPatchSchiedsrichterParams } from "@/core/generated/zod/inputs";
import { getSchiedsrichterById } from "@/features/schiedsrichter/queries";

import { valuesOf } from "./schiedsrichterValues";

import type { ActionAnswer } from "@/core/action";

const { shape } = SchiedsrichterPatchSchiedsrichterBody;
const kontakt = shape.kontakt.shape;

/**
 * What the editor's boxes send, each held to the referee write's own published rule for it: an empty box but the
 * name's is no value.
 */
const SaveSchiedsrichter = z.object({
  id: SchiedsrichterPatchSchiedsrichterParams.shape.schiedsrichter_id,
  version: shape.version,
  changes: z
    .object({
      name: shape.name,
      schule: blankIsNull(shape.schule),
      email: blankIsNull(kontakt.email),
      phone: blankIsNull(kontakt.phone),
      default_payment: numberBox(shape.default_payment),
    })
    .partial(),
  ...PAGE_HOLDER,
});

/**
 * Saves the referee editor's changes on the version the editor was read at, answering the version stored, behind the
 * passkey touch, since a save can hand the referee area to the address it stores. The write replaces the whole record,
 * so every field left alone is sent as stored, read again here. A corrected address of a person who has not confirmed
 * retires their link and mails a fresh one, which the status line says beside the save, naming the address it went
 * to. A name another referee holds, a retired one's included, is refused on the name's box, by the save's dry run
 * before the touch; a confirmed person's address is the editor's to show, never to change, as only an address change
 * moves it.
 */
export const saveSchiedsrichter = action({
  lane: "admin",
  passkey: true,
  dryRun: true,
  name: "saveSchiedsrichter",
  input: SaveSchiedsrichter,
  // The write nests the address under its contact, where the editor's box is the address alone.
  paths: { "kontakt.email": "changes.email" },
  examples: { "changes.name": COPY.shared.field.exampleName, "changes.phone": COPY.shared.field.examplePhone },
  // The holder is the touch's to judge, and no field of the referee's body, so the run reads none.
  run: async ({ id, version, changes }, { dryRun }): Promise<ActionAnswer<number>> => {
    const read = await getSchiedsrichterById(id);
    if (read === null) return { ok: false, reason: COPY.shared.failure.stale };

    const stored = read.schiedsrichter;
    const { schule, phone, default_payment, ...text } = changes;
    const { name, email } = { ...valuesOf(stored), ...text };
    const written = await schiedsrichterPatchSchiedsrichter(
      id,
      {
        name,
        schule: schule === undefined ? stored.schule : schule,
        kontakt: { email, phone: phone === undefined ? stored.kontakt.phone : phone },
        // The stored figure where the fee was left alone, never the text the editor shows it as.
        default_payment: default_payment ?? stored.default_payment,
        version,
      },
      { dry_run: dryRun },
    );
    // A passing dry run answers 204, which the client reads as no body: the version it was judged on stands, and the
    // editor's touch reads past the answer to the save.
    if (!written) return { ok: true, value: version };
    const value = written.version;
    return written.confirmation === null
      ? { ok: true, value }
      : { ok: true, value, note: ADMIN_COPY.schiedsrichter.sentTo(written.confirmation.email) };
  },
});
