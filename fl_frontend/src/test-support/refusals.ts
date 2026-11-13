import { refusalStatus } from "@/test-support/backend.ts";

import { APIBadStatusError } from "@/core/errors.ts";

import type { Code, FLRefusedField } from "@/core/generated/client/types.ts";

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
