import type { Code, FLRefusedField } from "./generated/client/types";

/**
 * What a request was, a write that may have landed or a read that changed nothing. Required on every API error rather
 * than defaulted, since a failed write may have landed and a failed read changed nothing.
 */
export type SentRequest = {
  method: string;
  /** A call changing nothing whatever its method says, as its operation's contract states. */
  readOnly: boolean;
};

/**
 * RFC 9110's safe methods: a request of one changes nothing on the server, however it ended. Its
 * fourth, TRACE, is one `fetch` refuses to send.
 */
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

/** Whether a request whose answer went wrong could have changed anything on the server. */
export function mayHaveWritten({ method, readOnly }: SentRequest): boolean {
  return !SAFE_METHODS.has(method) && !readOnly;
}

/**
 * A failure its own code proves wrote nothing: thrown before a transaction's commit, inside it or before it
 * opened. A write request answers it as failed rather than as of unknown outcome.
 */
export class RolledBackError extends Error {
  override name = "RolledBackError";

  constructor(cause: unknown) {
    super("Rolled back before its commit.", { cause });
  }
}

/**
 * An admin-tier call made with no actor recorded, refused before it is sent as the backend would refuse
 * it on arrival. A programming error: the call opened outside `runAdminRead`, an admin action's
 * guard and a person read whose page checked the session first.
 */
export class UnattributedAdminCallError extends Error {
  override name = "UnattributedAdminCallError";

  constructor(endpoint: string) {
    super(`An admin-tier call to ${endpoint} names no actor.`);
  }
}

/**
 * An admin-tier read whose grant the backend left unread: an outage, answered by the admin boundary's
 * retry, never a sign-in, which would meet the same unread grant.
 */
export class UnreadGrantError extends Error {
  override name = "UnreadGrantError";

  constructor() {
    super("The backend left the administrator's grant unread.");
  }
}

export class APIBadStatusError extends Error {
  traceId: string;
  statusCode: number;
  serverErrorCode?: Code;
  refusedFields: readonly FLRefusedField[];

  constructor({
    message,
    statusCode,
    serverErrorCode,
    refusedFields = [],
    traceId,
  }: {
    message: string;
    statusCode: number;
    serverErrorCode?: Code;
    refusedFields?: readonly FLRefusedField[];
    traceId: string;
  }) {
    // The fields `instrumentation.ts :: onRequestError` reads off the cause for the crash line.
    super(message, { cause: { traceId, statusCode, serverErrorCode } });

    this.name = "APIBadStatusError";
    this.traceId = traceId;
    this.statusCode = statusCode;
    this.serverErrorCode = serverErrorCode;
    this.refusedFields = refusedFields;
  }
}

/**
 * Every code that is no rule refusing what was asked: a credential, a request the API cannot take, a route it does
 * not serve, the store answering, the server failing. Every other code is one a slice's mapper words, the unique
 * index's `duplicate_key` among them.
 */
const NOT_A_REFUSAL: ReadonlySet<Code> = new Set<Code>([
  "access_key_refused",
  "missing_actor",
  "actor_not_admin",
  "session_refused",
  "payload_refused",
  "body_unreadable",
  "no_route",
  "method_not_served",
  "document_not_found",
  "version_stale",
  "no_database_client",
  "database_failed",
  "unknown_outcome",
  "unhandled_crash",
  "stored_data_invalid",
]);

/** Whether a code is one a slice's mapper words, by the code alone, never its status. */
export function isRefusalCode(code: Code | undefined): boolean {
  return code !== undefined && !NOT_A_REFUSAL.has(code);
}

/**
 * Whether the API refused the request, which every mapper asks before reading the code: a 4xx, at
 * whatever status the code's rule answers with. Never a 5xx, after which a write may have landed.
 */
export function isRefusal(error: unknown): error is APIBadStatusError {
  return error instanceof APIBadStatusError && error.statusCode >= 400 && error.statusCode < 500;
}

/**
 * Whether one of the API's rules refused the request, by the code's class: a code no arm names reaches its kind's
 * fallback at any status, and a protocol code, a routing one included, never does.
 */
export function isRuleRefusal(error: unknown): error is APIBadStatusError {
  return isRefusal(error) && isRefusalCode(error.serverErrorCode);
}

/**
 * Whether the API answered that the record a read names does not exist. By the code, never the status:
 * any other 404 is a route the framework did not serve (`no_route`) or the edge's own, a failure.
 */
function isRecordMissing(error: unknown): boolean {
  return error instanceof APIBadStatusError && error.statusCode === 404 && error.serverErrorCode === "document_not_found";
}

/**
 * A read's answer, `null` where the API answered that the record it names does not exist, which its page says as not
 * found. Called inside a `"use cache"` scope, never around one: an error thrown out of a scope reaches its caller
 * redacted to a digest, which nothing can recognise.
 */
export const orMissing = <Read>(read: Promise<Read>): Promise<Read | null> =>
  read.catch((error: unknown) => {
    if (isRecordMissing(error)) return null;
    throw error;
  });

/**
 * The backend answering against what this frontend was built for, such as a registry running no label
 * on a page this frontend serves, or a sweep answering a place not past the one it was sent. Named,
 * because a job's or a drain's failure line records an error's name alone, never its message: the name
 * is what tells a broken contract from a crash. Only a deploy repairs it, so no page renders it as a
 * failed read.
 */
export class ContractBreakError extends Error {
  override name = "ContractBreakError";
}

export class APINetworkError extends Error {
  traceId: string;

  constructor({ message, traceId, originalError }: { message: string; traceId: string; originalError?: unknown }) {
    // The failure `fetch` threw, as the standard cause: the one place it appears in the error Next prints.
    super(message, { cause: originalError });

    this.name = "APINetworkError";
    this.traceId = traceId;
  }
}

/**
 * Whether the backend answered the call with a failure of its own, which its line records: a refusal on the access
 * line, a 5xx with its stack. The frontend logs only what the backend never answered or answered unreadably.
 */
export function loggedByBackend(error: unknown): boolean {
  return error instanceof APIBadStatusError && error.serverErrorCode !== undefined;
}

/**
 * What a failed call says of its request, for a sweep's line, and nothing of a person: the status and code
 * tell a refusal from a crash, and the trace joins the backend's own line.
 */
export function requestOf(error: unknown): { status?: number; server_error_code?: string; trace_id?: string } {
  if (error instanceof APIBadStatusError)
    return { status: error.statusCode, server_error_code: error.serverErrorCode, trace_id: error.traceId };
  if (error instanceof APINetworkError) return { trace_id: error.traceId };
  return {};
}

/**
 * The refusals Resend's published error reference calls temporary, mirrored here because the token
 * decides whether a second attempt can succeed. **The source moves without us**
 * (<https://resend.com/docs/api-reference/errors>).
 */
const TRANSIENT_PROVIDER_ERRORS: ReadonlySet<string> = new Set([
  "concurrent_idempotent_requests",
  "resource_locked",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
  "rate_limit_exceeded",
  "application_error",
  "service_unavailable",
]);

export class MailSendError extends Error {
  traceId: string;
  statusCode: number;
  providerErrorName?: string;

  /**
   * Whether a second attempt could land. The token decides where the body carried one; the status
   * decides otherwise, `409 invalid_idempotent_request` being the one 4xx a retry cannot repair.
   */
  get isTransient(): boolean {
    if (this.providerErrorName !== undefined) return TRANSIENT_PROVIDER_ERRORS.has(this.providerErrorName);

    return this.statusCode === 429 || this.statusCode >= 500;
  }

  constructor({
    message,
    statusCode,
    providerErrorName,
    traceId,
  }: {
    message: string;
    statusCode: number;
    providerErrorName?: string;
    traceId: string;
  }) {
    super(message, { cause: { traceId, statusCode, providerErrorName } });

    this.name = "MailSendError";
    this.traceId = traceId;
    this.statusCode = statusCode;
    this.providerErrorName = providerErrorName;
  }
}
