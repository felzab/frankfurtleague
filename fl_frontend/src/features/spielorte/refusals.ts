import { isRefusal } from "@/shared/utils/actionError";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * `null` where the refusal is something else. It lands on the NAME box: `uniq_spielort_name` is this
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
