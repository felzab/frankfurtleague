/**
 * SHARED · thrown error → action result
 *
 * The pure half of `serverAction.ts`: maps whatever a mutation threw onto the `FormState` result
 * shape the admin forms render. Split out so the unit tests can cover the mapping — this module
 * imports no config and nothing `server-only`.
 *
 * The messages are deliberately generic German: the specific diagnosis (status, backend error code,
 * correlation id, zod issues) belongs to the server log, which `serverAction.ts` writes before this
 * mapping runs. What the admin needs is whether retrying can help.
 */

import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "@/core/errors";

import type { FormState } from "@/shared/types/types";

export function toActionErrorResult(error: unknown): NonNullable<FormState> {
  if (error instanceof APIBadStatusError) {
    if (error.statusCode === 409) {
      // The ordinary outcome of a create hitting a unique index (DB-COMMON-002, ADR-0032): the
      // record conflicts with one that exists -- possibly a retired row keeping its slot.
      return { success: false, error: "Der Eintrag steht im Konflikt mit einem bereits vorhandenen Datensatz." };
    }
    if (error.statusCode === 404) {
      return { success: false, error: "Der Datensatz wurde nicht gefunden. Möglicherweise wurde er inzwischen gelöscht." };
    }
    return { success: false, error: "Der Server hat mit einem Fehler geantwortet. Bitte versuche es erneut." };
  }

  if (error instanceof APINetworkError) {
    return {
      success: false,
      error: error.isTimeout
        ? "Zeitüberschreitung bei der Verbindung zum Server. Bitte versuche es erneut."
        : "Der Server ist gerade nicht erreichbar. Bitte versuche es später erneut.",
    };
  }

  if (error instanceof APIMalformedDataError) {
    return { success: false, error: "Die Antwort des Servers war fehlerhaft." };
  }

  return { success: false, error: "Ein unerwarteter Fehler ist aufgetreten." };
}
