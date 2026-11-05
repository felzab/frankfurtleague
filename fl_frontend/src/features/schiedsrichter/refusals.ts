import { SPERRLISTE_ADRESSE_GESPERRT_FELD } from "@/features/sperrliste/constants";
import { isRefusal } from "@/shared/utils/actionError";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * `null` where the refusal is something else. It lands on the NAME box: `uniq_schiedsrichter_name` is this
 * collection's only unique index, so the code can be about no other value the create or the edit sent.
 */
export function mapNameRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  // No repair sentence: the box carrying the message is itself the way out.
  if (error.serverErrorCode === "duplicate_key") {
    return { fieldErrors: { name: "Diesen Namen gibt es schon." } };
  }
  return null;
}

/** `null` where the refusal is something else. It lands on the address box, which is the value the list refused. */
export function mapGesperrteAdresseRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  return error.serverErrorCode === "schiedsrichter_address_barred"
    ? { fieldErrors: { "kontakt.email": SPERRLISTE_ADRESSE_GESPERRT_FELD } }
    : null;
}
