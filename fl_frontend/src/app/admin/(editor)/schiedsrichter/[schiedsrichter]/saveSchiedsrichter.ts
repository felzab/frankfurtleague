"use server";

import { z } from "zod";

import { action, blankIsNull, numberBox } from "@/core/action";
import { COPY } from "@/core/copy";
import { schiedsrichterPatchSchiedsrichter } from "@/core/generated/client/sdk";
import { SchiedsrichterPatchSchiedsrichterBody, SchiedsrichterPatchSchiedsrichterParams } from "@/core/generated/zod/inputs";
import { getSchiedsrichterById } from "@/features/schiedsrichter/queries";

import { valuesOf } from "./schiedsrichterValues";

import type { ActionAnswer } from "@/core/action";

const { shape } = SchiedsrichterPatchSchiedsrichterBody;
const kontakt = shape.kontakt.shape;

/**
 * What the editor's boxes send, each held to the referee write's own published rule for it: an empty box but the
 * name's is no value, as `fieldRules.ts` marks them.
 */
const SaveSchiedsrichter = z.object({
  id: SchiedsrichterPatchSchiedsrichterParams.shape.schiedsrichter_id,
  // The referee's version as the editor read it.
  version: shape.version,
  changes: z
    .object({
      name: shape.name,
      schule: blankIsNull(shape.schule),
      email: blankIsNull(kontakt.email),
      telefon: blankIsNull(kontakt.telefon),
      honorar: numberBox(shape.default_payment),
    })
    .partial(),
});

/**
 * Saves the referee editor's changes on the version the editor was read at, answering the version stored. The write
 * replaces the whole record, so every field left alone is sent as stored, read again here. A corrected address of a
 * person who has not confirmed retires their link and mails a fresh one, which the status line says beside the save,
 * naming the address it went to. A name another referee holds, a retired one's included, is refused on the name's box;
 * a confirmed person's address is the editor's to show, never to change, as only an address change moves it.
 */
export const saveSchiedsrichter = action({
  lane: "admin",
  name: "saveSchiedsrichter",
  input: SaveSchiedsrichter,
  ownWords: ["duplicate_key", "email_not_accepted", "schiedsrichter_address_barred"],
  paths: { name: "changes.name", "kontakt.email": "changes.email" },
  examples: { "changes.telefon": COPY.admin.schiedsrichter.telefonExample },
  run: async ({ id, version, changes }): Promise<ActionAnswer<number>> => {
    const read = await getSchiedsrichterById(id);
    if (read === null) return { ok: false, reason: COPY.shared.failure.stale };

    const stored = read.schiedsrichter;
    const { schule, telefon, honorar, ...text } = changes;
    const { name, email } = { ...valuesOf(stored), ...text };
    const written = await schiedsrichterPatchSchiedsrichter(id, {
      name,
      schule: schule === undefined ? stored.schule : schule,
      kontakt: { email, telefon: telefon === undefined ? stored.kontakt.telefon : telefon },
      // The stored figure where the fee was left alone, never the text the editor shows it as.
      default_payment: honorar ?? stored.default_payment,
      version,
    });
    const value = written.version;
    return written.confirmation === null
      ? { ok: true, value }
      : { ok: true, value, note: COPY.admin.schiedsrichter.sentTo(written.confirmation.email) };
  },
});
