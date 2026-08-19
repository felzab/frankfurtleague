import type { ZodError } from "zod";

/**
 * Keyed by the field's dotted path, which must also be the input's `name`: react-aria looks server errors up as
 * `serverErrors[name]`, so the two halves meet without a translation table.
 */
export type FieldErrors = Record<string, string>;

/**
 * One message per field: zod reports every failed check, and the first describes the value actually typed. An issue
 * with an empty path has no field to attach to, and stays with the generic error the action already returns.
 */
export function toFieldErrors(error: ZodError): FieldErrors {
  const fieldErrors: FieldErrors = {};

  for (const issue of error.issues) {
    if (issue.path.length === 0) continue;

    const key = issue.path.join(".");
    if (!(key in fieldErrors)) fieldErrors[key] = issue.message;
  }

  return fieldErrors;
}
