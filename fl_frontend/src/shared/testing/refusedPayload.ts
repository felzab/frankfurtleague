import { APIBadStatusError } from "@/core/errors.ts";

import type { FLRefusedField } from "@/core/schemas.ts";

/** One body field a refusal names, under the kind a validator's own refusal carries unless another is given. */
export const bodyField = (path: readonly (string | number)[], kind = "value_error"): FLRefusedField => ({ in: "body", path: [...path], kind });

/**
 * The `REQ-VAL-001` a refused payload arrives as, from `fl_frontend/src/core/api.ts :: apiClient`: one
 * constructor for every case, so a change to the error's shape moves one site rather than each file's copy.
 */
export function refusedPayload(fields: readonly FLRefusedField[], endpoint = "/probe"): APIBadStatusError {
  return new APIBadStatusError({
    message: "refused",
    url: `http://backend/api/v0${endpoint}`,
    statusCode: 422,
    serverErrorCode: "REQ-VAL-001",
    refusedFields: fields,
    endpoint: endpoint,
    method: "POST",
    readOnly: false,
    traceId: "0",
  });
}
