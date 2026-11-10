import { APIBadStatusError } from "@/core/errors.ts";

import type { Code } from "@/core/generated/client/types.ts";

/**
 * The refusal the API client raises for `code`, or for none: `fl_frontend/src/core/api.ts` reads a code the contract
 * does not name as no code at all. A missing record at 404, which `fl_frontend/src/core/errors.ts :: isRecordMissing`
 * reads beside its code, a refused body at 422, and every rule at 409 unless a case names the status.
 */
export function refused(
  code: Code | undefined,
  statusCode = code === "document_not_found" ? 404 : code === "payload_refused" || code === "body_unreadable" ? 422 : 409,
): APIBadStatusError {
  return new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/",
    statusCode,
    serverErrorCode: code,
    endpoint: "/",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });
}
