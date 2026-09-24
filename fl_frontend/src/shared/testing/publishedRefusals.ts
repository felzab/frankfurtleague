import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { APIBadStatusError } from "@/core/errors.ts";
import { DOCUMENT_PATH, REGENERATE_CITATION } from "@/core/openapiDocument.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

import type { FieldErrors } from "@/shared/utils/validation.ts";

type JsonObject = Record<string, unknown>;

const isObject = (value: unknown): value is JsonObject => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The unique index's refusal, and the one code the shared reader's 409 fallback words. Which mapper
 * answers it instead, on a box or in a banner, is `docs/frontend/spec.md` §1.9's.
 */
export const DUPLICATE_KEY = "DB-COMMON-002";

/** A code no rule declares, which reaches the shared reader's 409 fallback and nothing else. */
const UNCLAIMED = "REQ-UNCLAIMED-000";

function readDocument(): JsonObject {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(DOCUMENT_PATH, "utf8"));
  } catch (cause) {
    throw new Error(`Could not read ${DOCUMENT_PATH}. Generate it with the command ${REGENERATE_CITATION} declares.`, { cause });
  }
  if (!isObject(parsed) || !isObject(parsed.paths)) throw new Error(`${DOCUMENT_PATH} publishes no paths`);

  return parsed;
}

const DOCUMENT = readDocument();

/**
 * Every `error_code` enum a schema carries, its `allOf` members and `$ref` targets followed: the
 * backend narrows the failure body by composing it, and an enum it moved into a component is still
 * the operation's own.
 */
function codeEnums(schema: unknown, seen: ReadonlySet<string> = new Set()): unknown[] {
  if (!isObject(schema)) return [];

  const ref = schema.$ref;
  if (typeof ref === "string") {
    const name = ref.replace(/^#\/components\/schemas\//, "");
    const components = isObject(DOCUMENT.components) && isObject(DOCUMENT.components.schemas) ? DOCUMENT.components.schemas : {};
    if (seen.has(name) || !(name in components)) throw new Error(`the document cannot resolve ${ref}`);

    return codeEnums(components[name], new Set([...seen, name]));
  }

  const own = isObject(schema.properties) && isObject(schema.properties.error_code) ? schema.properties.error_code.enum : undefined;
  const members = Array.isArray(schema.allOf) ? schema.allOf.flatMap((member) => codeEnums(member, seen)) : [];

  return own === undefined ? members : [own, ...members];
}

/**
 * Every code `fl_backend/openapi.json` publishes on one operation's 409, the operation spelled
 * `<METHOD> <path>` below the version prefix. Throws where it publishes none: an empty answer would
 * run a caller's loop zero times, green.
 */
export function publishedRefusals(operation: string): string[] {
  const [method = "", route = ""] = operation.split(" ", 2);
  const paths = DOCUMENT.paths as JsonObject;
  // Derived rather than spelled: the document is generated under the test configuration, whose
  // `API_VERSION` names the prefix.
  const served = Object.keys(paths).filter((published) => /^\/api\/v\d+/.exec(published)?.[0] + route === published);
  if (served.length !== 1) {
    throw new Error(
      `the document serves ${String(served.length)} paths for ${operation}; refresh it with the command ${REGENERATE_CITATION} declares`,
    );
  }

  const item = paths[served[0] ?? ""];
  const responses = isObject(item) && isObject(item[method.toLowerCase()]) ? (item[method.toLowerCase()] as JsonObject).responses : undefined;
  if (!isObject(responses)) throw new Error(`the document publishes no ${method} on ${route}`);

  const conflict = responses["409"];
  if (!isObject(conflict)) throw new Error(`the document publishes no 409 on ${operation}`);

  const body = isObject(conflict.content) ? conflict.content["application/json"] : undefined;
  const enums = codeEnums(isObject(body) ? body.schema : undefined);
  // One enum and no more: two would leave which of them the backend answers from to the reader.
  const [codes] = enums;
  if (enums.length !== 1 || !Array.isArray(codes) || codes.length === 0 || !codes.every((code) => typeof code === "string")) {
    throw new Error(`the 409 on ${operation} does not publish its codes as one enum of strings`);
  }

  return [...(codes as string[])].sort();
}

/**
 * The refusal the API client raises when `operation` answers `serverErrorCode`, so a mapper is asked
 * rather than read.
 */
export function refusedOn(operation: string, serverErrorCode: string, statusCode = 409): APIBadStatusError {
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
 * What a write shows for one refusal: the slice's mapper, then
 * `fl_frontend/src/shared/utils/actionError.ts :: toActionErrorResult`, and `null` where the code
 * reaches that reader's fallback, which words `DUPLICATE_KEY` alone. A public route words that code
 * itself (`fl_frontend/src/shared/utils/publicRoute.ts :: SCHON_VORLIEGEND`).
 */
export function answerShown(operation: string, code: string, mapper: (error: unknown) => unknown): unknown {
  const refusal = refusedOn(operation, code);
  const own = mapper(refusal);
  if (own !== null) return own;

  const shared = toActionErrorResult(refusal).error;
  return code === DUPLICATE_KEY || shared !== toActionErrorResult(refusedOn(operation, UNCLAIMED)).error ? shared : null;
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
 * Calls a real action once per code, its doubled write refusing with it, against `actionAnswer` over
 * the mapper it should consult: an action asking another mapper, or none, fails by some code.
 */
export async function assertEachAnswered({
  operation,
  codes,
  refuseWith,
  act,
  mapped,
  readOnly = false,
}: {
  operation: string;
  /** `publishedRefusals(operation)`, spelled at the call so the coverage sweep reads the operation there. */
  codes: readonly string[];
  /** The doubled write's `answerWith`. */
  refuseWith: (next: () => Promise<unknown>) => void;
  act: () => Promise<unknown>;
  mapped: (refusal: APIBadStatusError) => string | { error?: string; fieldErrors?: FieldErrors } | null;
  readOnly?: boolean;
}): Promise<void> {
  for (const code of codes) {
    const refusal = refusedOn(operation, code);
    refuseWith(() => Promise.reject(refusal));

    assert.deepEqual(asRead(await act()), await actionAnswer(refusal, mapped(refusal), readOnly), `${code} on ${operation}`);
  }
}
