import { expect } from "vitest";

import { APIBadStatusError } from "@/core/errors.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

import type { Code } from "@/core/generated/client/types.ts";
import type { FieldErrors } from "@/shared/utils/validation.ts";

/** The unique index's refusal, and the one code the shared reader's fallback words. */
export const DUPLICATE_KEY = "DB-COMMON-002" satisfies Code;

/**
 * The rule codes a case judges, as the backend's service for one operation raises them: a list the case states
 * rather than one the document publishes, which names every code once for the whole API.
 */
export const refusalCodes = (...codes: readonly Code[]): Code[] => [...codes];

/** A rule's code the shared reader words with its fallback alone, as it words every rule no table of its names. */
const UNCLAIMED = "REQ-ACTIVATE-001" satisfies Code;

/**
 * The refusal the API client raises for `code`, or for none: `fl_frontend/src/core/api.ts` reads a code the contract
 * does not name as no code at all. A missing record at 404, which `fl_frontend/src/core/errors.ts :: isRecordMissing`
 * reads beside its code, a refused body at 422, and every rule at 409 unless a case names the status: a mapper reads
 * the code, never the status, and `answerShown` asks at a second one to hold that.
 */
export function refused(
  code: Code | undefined,
  statusCode = code === "DB-COMMON-001" ? 404 : code?.startsWith("REQ-VAL-") === true ? 422 : 409,
): APIBadStatusError {
  return raised(code, statusCode);
}

/** The error itself, as `fl_frontend/src/core/api.ts` raises one. */
function raised(serverErrorCode: Code | undefined, statusCode: number): APIBadStatusError {
  return new APIBadStatusError({
    message: "refused",
    url: "http://backend/api/v0/",
    statusCode,
    serverErrorCode,
    endpoint: "/",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });
}

/** The same refusal at another status a rule answers with, so an answer that moves with the status fails. */
const atAnotherStatus = (refusal: APIBadStatusError): APIBadStatusError =>
  raised(refusal.serverErrorCode, refusal.statusCode === 409 ? 422 : 409);

/** What is shown for one refusal as raised, its mapper having answered `own`. */
function shownFrom(refusal: APIBadStatusError, own: unknown): unknown {
  if (own !== null) return own;

  const shared = toActionErrorResult(refusal).error;
  const unclaimed = toActionErrorResult(raised(UNCLAIMED, refusal.statusCode)).error;
  return refusal.serverErrorCode === DUPLICATE_KEY || shared !== unclaimed ? shared : null;
}

/**
 * What a write shows for one refusal: the slice's mapper, then
 * `fl_frontend/src/shared/utils/actionError.ts :: toActionErrorResult`, and `null` where the code
 * reaches that reader's fallback, which words `DUPLICATE_KEY` alone.
 */
export function answerShown(code: Code | undefined, mapper: (error: unknown) => unknown): unknown {
  const refusal = refused(code);
  const moved = atAnotherStatus(refusal);
  const shown = shownFrom(refusal, mapper(refusal));
  expect(shownFrom(moved, mapper(moved)), `${String(code)} is answered by its status`).toStrictEqual(shown);

  return shown;
}

/** `answerShown` for a mapper that answers once a read it makes has settled. */
export async function answerSettled(code: Code | undefined, mapper: (error: unknown) => unknown): Promise<unknown> {
  const refusal = refused(code);
  const moved = atAnotherStatus(refusal);
  const shown = shownFrom(refusal, await mapper(refusal));
  expect(shownFrom(moved, await mapper(moved)), `${String(code)} is answered by its status`).toStrictEqual(shown);

  return shown;
}

/** A failure as the form reads it back, where a key left `undefined` and a key left out read alike. */
const asRead = (result: unknown): unknown => JSON.parse(JSON.stringify(result)) as unknown;

/**
 * What an action returns for `refusal` where its mapper answers `mapped`: a sentence as the failure, a
 * field map through `refusalResult`, or for `null` the shared reader's words a rethrow reaches.
 */
async function actionAnswer(
  refusal: APIBadStatusError,
  mapped: string | { error?: string; fieldErrors?: FieldErrors } | null,
  readOnly = false,
): Promise<unknown> {
  // Imported late: `adminMutation.ts` reaches the logger, which the caller's
  // `fl_frontend/src/test-support/actionDoubles.ts :: doubleActionRequest` stands in for first.
  const { refusalResult } = await import("@/shared/utils/adminMutation.ts");

  if (mapped === null) return asRead(toActionErrorResult(refusal, { method: "POST", readOnly }));
  return asRead(typeof mapped === "string" ? { success: false, error: mapped } : refusalResult(mapped));
}

/**
 * Calls a real action per code, its doubled write refusing at two statuses, against `actionAnswer` over the mapper it
 * should consult: an action asking another mapper, or none, or reading the status, fails by some code.
 */
export async function assertEachAnswered({
  codes,
  refuseWith,
  act,
  mapped,
  readOnly = false,
}: {
  codes: readonly Code[];
  /** The doubled write's `answerWith`. */
  refuseWith: (next: () => Promise<unknown>) => void;
  act: () => Promise<unknown>;
  mapped: (refusal: APIBadStatusError) => string | { error?: string; fieldErrors?: FieldErrors } | null;
  readOnly?: boolean;
}): Promise<void> {
  for (const code of codes) {
    const refusal = refused(code);
    const expected = await actionAnswer(refusal, mapped(refusal), readOnly);

    for (const sent of [refusal, atAnotherStatus(refusal)]) {
      refuseWith(() => Promise.reject(sent));
      expect(asRead(await act()), `${code} at ${String(sent.statusCode)}`).toStrictEqual(expected);
    }
  }
}
