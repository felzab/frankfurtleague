import { APIBadStatusError } from "@/core/errors.ts";

import type { Code, FLRefusedField } from "@/core/generated/client/types.ts";

/**
 * The status the backend refuses `code` at, unless a case names another: a missing record at 404, which
 * `fl_frontend/src/core/errors.ts :: isRecordMissing` reads beside its code, a refused body at 422, and every rule at 409.
 */
export const refusalStatus = (code: Code | undefined): number =>
  code === "document_not_found" ? 404 : code === "payload_refused" || code === "body_unreadable" ? 422 : 409;

/**
 * The refusal the API client raises for `code`, or for none: `fl_frontend/src/core/api.ts` reads a code the contract
 * does not name as no code at all, at `refusalStatus` unless a case names the status. One constructor for every case,
 * so a change to the error's shape moves one site rather than each file's copy.
 */
export function refused(
  code: Code | undefined,
  { status = refusalStatus(code), fields = [] }: { status?: number; fields?: readonly FLRefusedField[] } = {},
): APIBadStatusError {
  return new APIBadStatusError({
    message: "refused",
    statusCode: status,
    serverErrorCode: code,
    refusedFields: fields,
    traceId: "0",
  });
}
