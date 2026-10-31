import type { Code, FLRefusedField } from "./generated/client/types";

/**
 * What a request was, a write that may have landed or a read that changed nothing, which
 * `fl_frontend/src/core/api.ts :: sendToBackend` judges every landed write's drain by. Required on every API error
 * rather than defaulted, since a failed write may have landed and a failed read changed nothing.
 */
export type SentRequest = {
  method: string;
  /** A call changing nothing whatever its method says, declared where it is made (`fl_frontend/src/core/api.ts :: FetchOptions`). */
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
 * it on arrival. A programming error: the call opened outside
 * `runAdminRead` and outside an admin action's guard.
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

/**
 * A person-tier read made with no person signed in, or one barred: a caller outside a page's own seat
 * check, which reads the session before it reads anything.
 */
export class PersonReadWithoutSubjectError extends Error {
  override name = "PersonReadWithoutSubjectError";

  constructor() {
    super("A person-tier read was made with no person signed in.");
  }
}

export class APIBadStatusError extends Error {
  traceId: string;
  statusCode: number;
  serverErrorCode?: Code;
  refusedFields: readonly FLRefusedField[];
  url: string;
  endpoint: string;
  // Redesign: these two fields, here and on `APINetworkError`, go with their last readers, the old write path's
  // `shared/utils/actionError.ts` and `shared/utils/writeOutcome.ts`.
  method: string;
  readOnly: boolean;

  constructor({
    message,
    url,
    statusCode,
    serverErrorCode,
    refusedFields = [],
    endpoint,
    method,
    readOnly,
    traceId,
    originalError,
  }: SentRequest & {
    message: string;
    url: string;
    statusCode: number;
    serverErrorCode?: Code;
    refusedFields?: readonly FLRefusedField[];
    endpoint: string;
    traceId: string;
    originalError?: unknown;
  }) {
    const errorCause = originalError
      ? { originalError, traceId, statusCode, serverErrorCode, url, endpoint }
      : { traceId, statusCode, serverErrorCode, url, endpoint };
    super(message, { cause: errorCause });

    this.name = "APIBadStatusError";
    this.traceId = traceId;
    this.statusCode = statusCode;
    this.serverErrorCode = serverErrorCode;
    this.refusedFields = refusedFields;
    this.url = url;
    this.endpoint = endpoint;
    this.method = method;
    this.readOnly = readOnly;
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
  "person_barred",
  "confirmation_required",
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
 * Whether the API answered that the record a read names does not exist. By the code, never the status:
 * any other 404 is a route the framework did not serve (`no_route`) or the edge's own, a failure.
 */
export function isRecordMissing(error: unknown): boolean {
  return error instanceof APIBadStatusError && error.statusCode === 404 && error.serverErrorCode === "document_not_found";
}

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
  url: string;
  isTimeout: boolean;
  // Redesign: these two fields go with `APIBadStatusError`'s.
  method: string;
  readOnly: boolean;

  constructor({
    message,
    url,
    method,
    readOnly,
    traceId,
    isTimeout,
    originalError,
  }: SentRequest & {
    message: string;
    url: string;
    traceId: string;
    isTimeout: boolean;
    originalError?: unknown;
  }) {
    const errorCause = originalError ? { originalError, traceId, isTimeout, url, method } : { traceId, isTimeout, url, method };
    super(message, { cause: errorCause });

    this.name = "APINetworkError";
    this.traceId = traceId;
    this.url = url;
    this.method = method;
    this.readOnly = readOnly;
    this.isTimeout = isTimeout;
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
 * (<https://resend.com/docs/api-reference/errors>, read 2026-09-08).
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
  url: string;

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
    url,
    statusCode,
    providerErrorName,
    traceId,
  }: {
    message: string;
    url: string;
    statusCode: number;
    providerErrorName?: string;
    traceId: string;
  }) {
    super(message, { cause: { traceId, statusCode, providerErrorName, url } });

    this.name = "MailSendError";
    this.traceId = traceId;
    this.statusCode = statusCode;
    this.providerErrorName = providerErrorName;
    this.url = url;
  }
}
