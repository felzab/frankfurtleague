"use server";

import { postSpielortAction } from "@/features/spielorte/actions";

import type { SpielortFeld } from "./spielortRegeln";

/** One posted field's text; a field the form left out reads as empty. */
const feld = (formData: FormData, name: SpielortFeld) => {
  const wert = formData.get(name);
  return typeof wert === "string" ? wert : "";
};

/**
 * Creates a venue from the create dialog's fields, through the venue slice's own write, its refusals and its
 * refresh of the page included: the list behind the dialog, or the match editor's venue choice, reads the new
 * venue at once. Answers whether the venue was created; the dialog stays open, its input kept, where not.
 */
export async function spielortAnlegen(formData: FormData): Promise<boolean> {
  const mietpreis = feld(formData, "mietpreis").trim();
  const result = await postSpielortAction({
    name: feld(formData, "name"),
    // Digits alone make a price; anything else is the empty price the write refuses by name.
    default_mietpreis: /^\d+$/.test(mietpreis) ? Number(mietpreis) : null,
    address: {
      strasse: feld(formData, "strasse"),
      hausnummer: feld(formData, "hausnummer"),
      plz: feld(formData, "plz"),
      stadtteil: feld(formData, "stadtteil"),
      stadt: feld(formData, "stadt"),
    },
  });
  return result.success;
}
