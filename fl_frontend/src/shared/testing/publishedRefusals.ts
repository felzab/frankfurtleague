import assert from "node:assert/strict";

import { APIBadStatusError, isRefusalCode } from "@/core/errors.ts";
import { publishedOperations, REGENERATE_CITATION } from "@/core/openapiDocument.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

import type { PublishedOperation } from "@/core/openapiDocument.ts";
import type { FieldErrors } from "@/shared/utils/validation.ts";

/**
 * The unique index's refusal, and the one code the shared reader's fallback words. Which mapper
 * answers it instead, on a box or in a banner, is `docs/frontend/spec.md` §1.9's.
 */
export const DUPLICATE_KEY = "DB-COMMON-002";

/** A code no rule declares, which reaches the shared reader's fallback and nothing else. */
const UNCLAIMED = "REQ-UNCLAIMED-000";

const OPERATIONS = new Map(publishedOperations().map((published) => [published.operation, published]));

/** `operation` as the document publishes it, spelled `<METHOD> <path>` below the version prefix. */
function publishedOperation(operation: string): PublishedOperation {
  const published = OPERATIONS.get(operation);
  if (published === undefined)
    throw new Error(`the document publishes no ${operation}; refresh it with the command ${REGENERATE_CITATION} declares`);

  return published;
}

/**
 * Every refusal code `fl_backend/openapi.json` publishes on one operation, under whichever status its
 * rule answers with. Throws where it publishes none: an empty answer would run a caller's loop zero
 * times, green.
 */
export function publishedRefusals(operation: string): string[] {
  const codes = new Set(
    publishedOperation(operation)
      .answers.map(({ code }) => code)
      .filter(isRefusalCode),
  );
  if (codes.size === 0) throw new Error(`the document publishes no refusal on ${operation}`);

  return [...codes].sort();
}

/**
 * The one status `operation` publishes `code` under. Throws for a code published under none or under
 * two, where a caller asking for it names the status itself.
 */
function publishedStatus(operation: string, code: string): number {
  const statuses = publishedOperation(operation)
    .answers.filter((answer) => answer.code === code)
    .map(({ status }) => status);
  if (statuses.length !== 1) {
    throw new Error(`${operation} publishes ${code} under ${String(statuses.length)} statuses; name the one this case asks about`);
  }

  return statuses[0] ?? 0;
}

/**
 * The refusal the API client raises when `operation` answers `serverErrorCode`, at the status the
 * document publishes it under unless a case names another, so a mapper is asked rather than read.
 */
export function refusedOn(
  operation: string,
  serverErrorCode: string,
  statusCode = publishedStatus(operation, serverErrorCode),
): APIBadStatusError {
  const [method = "", endpoint = ""] = operation.split(" ", 2);

  return new APIBadStatusError({
    message: "refused",
    url: `http://backend/api/v0${endpoint}`,
    statusCode,
    serverErrorCode,
    endpoint,
    method,
    readOnly: false,
    traceId: "0",
  });
}

/**
 * The same refusal at another status a rule answers with. Codes are unique across the API, so a rule
 * the backend moves keeps its answer, and each question below is put at both statuses.
 */
function atAnotherStatus(operation: string, refusal: APIBadStatusError): APIBadStatusError {
  return refusedOn(operation, refusal.serverErrorCode ?? "", refusal.statusCode === 409 ? 422 : 409);
}

/** What is shown for one refusal as raised, its mapper having answered `own`. */
function shownFrom(operation: string, refusal: APIBadStatusError, own: unknown): unknown {
  if (own !== null) return own;

  const shared = toActionErrorResult(refusal).error;
  const unclaimed = toActionErrorResult(refusedOn(operation, UNCLAIMED, refusal.statusCode)).error;
  return refusal.serverErrorCode === DUPLICATE_KEY || shared !== unclaimed ? shared : null;
}

/**
 * What a write shows for one refusal: the slice's mapper, then
 * `fl_frontend/src/shared/utils/actionError.ts :: toActionErrorResult`, and `null` where the code
 * reaches that reader's fallback, which words `DUPLICATE_KEY` alone. A public route words that code
 * itself (`fl_frontend/src/shared/utils/publicRoute.ts :: SCHON_VORLIEGEND`).
 */
export function answerShown(operation: string, code: string, mapper: (error: unknown) => unknown): unknown {
  const refusal = refusedOn(operation, code);
  const moved = atAnotherStatus(operation, refusal);
  const shown = shownFrom(operation, refusal, mapper(refusal));
  // Asked at a second status too, so an answer that moves with the status fails.
  assert.deepEqual(shownFrom(operation, moved, mapper(moved)), shown, `${code} on ${operation} is answered by its status`);

  return shown;
}

/** `answerShown` for a mapper that answers once a read it makes has settled. */
export async function answerSettled(operation: string, code: string, mapper: (error: unknown) => unknown): Promise<unknown> {
  const refusal = refusedOn(operation, code);
  const moved = atAnotherStatus(operation, refusal);
  const shown = shownFrom(operation, refusal, await mapper(refusal));
  assert.deepEqual(shownFrom(operation, moved, await mapper(moved)), shown, `${code} on ${operation} is answered by its status`);

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
  // `fl_frontend/src/shared/testing/actionDoubles.ts :: doubleActionRequest` stands in for first.
  const { refusalResult } = await import("@/shared/utils/adminMutation.ts");

  if (mapped === null) return asRead(toActionErrorResult(refusal, { method: "POST", readOnly }));
  return asRead(typeof mapped === "string" ? { success: false, error: mapped } : refusalResult(mapped));
}

/**
 * Calls a real action per code, its doubled write refusing at the published status and at another,
 * against `actionAnswer` over the mapper it should consult: an action asking another mapper, or none,
 * or reading the status, fails by some code.
 */
export async function assertEachAnswered({
  operation,
  refuseWith,
  act,
  mapped,
  readOnly = false,
}: {
  operation: string;
  /** The doubled write's `answerWith`. */
  refuseWith: (next: () => Promise<unknown>) => void;
  act: () => Promise<unknown>;
  mapped: (refusal: APIBadStatusError) => string | { error?: string; fieldErrors?: FieldErrors } | null;
  readOnly?: boolean;
}): Promise<void> {
  for (const code of publishedRefusals(operation)) {
    const refusal = refusedOn(operation, code);
    const expected = await actionAnswer(refusal, mapped(refusal), readOnly);

    for (const sent of [refusal, atAnotherStatus(operation, refusal)]) {
      refuseWith(() => Promise.reject(sent));
      assert.deepEqual(asRead(await act()), expected, `${code} at ${String(sent.statusCode)} on ${operation}`);
    }
  }
}
