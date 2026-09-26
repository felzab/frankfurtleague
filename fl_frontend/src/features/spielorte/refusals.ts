import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal } from "@/shared/utils/refusal";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * `null` where the refusal is something else. It lands on the NAME box: `uniq_spielort_name` is this
 * collection's only unique index, so the code can be about no other value the create or the edit sent.
 */
export function mapNameRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  // No repair sentence: the box carrying the message is itself the way out (`docs/frontend/spec.md` §1.12).
  if (error.serverErrorCode === "DB-COMMON-002") {
    return { fieldErrors: { name: "Diesen Namen gibt es schon." } };
  }
  return null;
}

/** `null` where the refusal is something else; it lands on no field, the retire control being a dialog. */
export function mapRetireRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  if (error.serverErrorCode === "REQ-RETIRE-003") {
    return buildRefusal({
      reason: "Für diesen Spielort sind noch Spiele angesetzt, die kein Ergebnis haben",
      repair: "Verlege diese Spiele auf einen anderen Spielort oder sage sie ab",
    });
  }
  return null;
}
