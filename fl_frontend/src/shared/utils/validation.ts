import type { ZodError } from "zod";

/**
 * Field-level validation messages, keyed by the field's dotted path in the payload
 * (`"name"`, `"kontakt.email"`, `"ort.mietpreis"`).
 *
 * The key is also the `name` prop of the input that renders the message: react-aria's
 * `FormValidationContext` looks server errors up as `serverErrors[name]`
 * (`react-stately/private/form/useFormValidationState`), so naming a field after its payload path
 * is what makes the two halves meet without a translation table.
 */
export type FieldErrors = Record<string, string>;

/**
 * Flattens a zod failure into one message per field.
 *
 * Zod reports every failed check, so a field can carry several issues; the first is kept because
 * `FieldError` renders a single line under the input and the first issue is the one describing the
 * value the user actually typed. Issues with an empty path are whole-payload failures with no field
 * to attach to — those stay with the generic error message the action already returns.
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
