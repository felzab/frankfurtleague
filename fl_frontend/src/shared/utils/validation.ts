import type { ZodError } from "zod";

/**
 * Keyed by the field's dotted path, which must also be the input's `name`: react-aria looks server errors up as
 * `serverErrors[name]`, so the two halves meet without a translation table.
 */
export type FieldErrors = Record<string, string>;

/**
 * The generic banner for a payload the schema or the API refused, declared once, in the refusal format §1.12 of
 * `docs/frontend/spec.md` sets. The field messages beside it carry the specifics.
 */
export const VALIDATION_FAILED = "Überprüfe Deine Eingaben.";

/**
 * One message per field: zod reports every failed check, and the first describes the value actually typed. An issue
 * with an empty path has no field to attach to, and stays with the generic error the action already returns.
 */
export function toFieldErrors(error: ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};

  for (const issue of error.issues) {
    if (issue.path.length === 0) continue;

    const key = issue.path.join(".");
    // `hasOwn` and not `in`: `in` walks the prototype, so a path named `constructor` would read as taken.
    if (!Object.hasOwn(fieldErrors, key)) fieldErrors[key] = issue.message;
  }

  return fieldErrors;
}
