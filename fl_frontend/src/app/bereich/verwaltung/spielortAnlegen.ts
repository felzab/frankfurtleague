"use server";

import { COPY } from "@/core/copy";
import { postSpielort } from "@/features/spielorte/mutations";
import { FLPostSpielortPayloadSchema } from "@/features/spielorte/schemas";
import { isRefusal } from "@/shared/utils/actionError";
import { FORBIDDEN_BY_REFUSAL, runAdminMutation } from "@/shared/utils/adminMutation";

import type { AdminRefusal } from "@/core/auth";
import type { ActionAnswer } from "@/kit/useFormAction";
import type { SpielortFeld } from "./spielortRegeln";

/** One posted field's text; a field the form left out reads as empty. */
const feld = (formData: FormData, name: SpielortFeld) => {
  const wert = formData.get(name);
  return typeof wert === "string" ? wert : "";
};

type Antwort = { success: boolean; antwort: ActionAnswer };

/**
 * Creates a venue from the create dialog's fields, through the venue slice's write and the guard's spine,
 * whose refresh of the page lets the list behind the dialog, or the match editor's venue choice, read the new
 * venue at once. A name another venue holds is refused on the name's field, an ended session and a create
 * nobody can tell landed each in its own line, anything else refused as the unexpected failure; the dialog
 * stays open with its input kept.
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
  const geprueft = FLPostSpielortPayloadSchema.safeParse(payload);
  if (!geprueft.success) return { ok: false };

  // Why the guard turned the create away, kept as it judged it: the catalogue words an ended session.
  const abgewiesen: { grund?: AdminRefusal } = {};
  const turnedAway = (grund: AdminRefusal) => {
    abgewiesen.grund = grund;
    return FORBIDDEN_BY_REFUSAL[grund];
  };

  const result = await runAdminMutation("spielortAnlegen", { stepUp: false, turnedAway }, async (): Promise<Antwort> => {
    try {
      const angelegt = await postSpielort(geprueft.data);
      return angelegt.acknowledged ? { success: true, antwort: { ok: true, value: undefined } } : { success: false, antwort: { ok: false } };
    } catch (error) {
      if (!isRefusal(error)) throw error;
      // Told by the code, never by the field a refusal names: the backend's own schema refuses a name too, one
      // whose characters JavaScript's trim keeps and Python's strip drops, and that name is no taken one.
      if (error.serverErrorCode === "DB-COMMON-002")
        return { success: false, antwort: { ok: false, fieldErrors: { name: COPY.shared.feld.schonVergeben } } };
      return { success: false, antwort: { ok: false } };
    }
  });

  if ("antwort" in result) return result.antwort;
  // The spine's own answers. A create that may have landed whatever its answer said: a reload shows whether
  // it did, where a second press would meet the venue it made as a taken name.
  if (result.outcome === "unknown") return { ok: false, reason: COPY.shared.fehler.veraltet };
  if (abgewiesen.grund === "signIn") return { ok: false, reason: COPY.shared.fehler.abgelaufen };
  // A grant gone or unread, and a throw no refusal explains, have no line of the catalogue's: the unexpected failure.
  return { ok: false };
}
