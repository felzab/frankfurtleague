"use server";

import { COPY } from "@/core/copy";
import { postSpielortAction } from "@/features/spielorte/actions";
import { FLPostSpielortPayloadSchema } from "@/features/spielorte/schemas";

import type { ActionAnswer } from "@/kit/useFormAction";
import type { SpielortFeld } from "./spielortRegeln";

/** One posted field's text; a field the form left out reads as empty. */
const feld = (formData: FormData, name: SpielortFeld) => {
  const wert = formData.get(name);
  return typeof wert === "string" ? wert : "";
};

/**
 * Creates a venue from the create dialog's fields, through the venue slice's own write, its refusals and its
 * refresh of the page included: the list behind the dialog, or the match editor's venue choice, reads the new
 * venue at once. A name another venue holds is refused on the name's field; anything else refused answers as
 * the unexpected failure, and the dialog stays open with its input kept.
 */
export async function spielortAnlegen(formData: FormData): Promise<ActionAnswer> {
  const mietpreis = feld(formData, "mietpreis").trim();
  const payload = {
    name: feld(formData, "name"),
    // Digits alone make a price; anything else is the empty price the write refuses.
    default_mietpreis: /^\d+$/.test(mietpreis) ? Number(mietpreis) : null,
    address: {
      strasse: feld(formData, "strasse"),
      hausnummer: feld(formData, "hausnummer"),
      plz: feld(formData, "plz"),
      stadtteil: feld(formData, "stadtteil"),
      stadt: feld(formData, "stadt"),
    },
  };

  // The schema's refusals are worded in the old pages' words, which the catalogue holds none of, so a payload
  // it refuses answers as the unexpected failure; the dialog's fields hold most of its rules before the send.
  // Checked here, ahead of the write, because the write words its schema's refusals and a taken name alike as
  // a message on `name`, which only their order tells apart.
  if (!FLPostSpielortPayloadSchema.safeParse(payload).success) return { ok: false };

  const result = await postSpielortAction(payload);
  if (result.success) return { ok: true, value: undefined };
  // Past the schema, the write's one refusal on a field is a name another venue holds.
  if (result.fieldErrors?.name !== undefined) return { ok: false, fieldErrors: { name: COPY.shared.feld.schonVergeben } };
  // The guard's refusals, a session ended among them, carry no words of the catalogue's.
  return { ok: false };
}
