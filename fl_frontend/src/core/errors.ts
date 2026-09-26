import type { FLRefusedField } from "./schemas";

/**
 * What an error says about the request it answers. Required on every API error rather than defaulted:
 * a failed write may have landed and a failed read changed nothing, and
 * `fl_frontend/src/shared/utils/actionError.ts :: toActionErrorResult` tells them apart by it.
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
 * A failure its own code proves wrote nothing: thrown inside a transaction, before its commit, so the
 * transaction rolled back. A write request answers it as failed rather than as of unknown outcome.
 */
export class RolledBackError extends Error {
  override name = "RolledBackError";

  constructor(cause: unknown) {
    super("Rolled back before its commit.", { cause });
  }
}

/**
 * An admin-tier call made with no actor recorded, refused before it is sent as the backend would refuse
 * it on arrival (`docs/backend/spec.md :: I41`). A programming error: the call opened outside
 * `runAdminRead` and outside an admin action's guard.
 */
export class UnattributedAdminCallError extends Error {
  override name = "UnattributedAdminCallError";

  constructor(endpoint: string) {
    super(`An admin-tier call to ${endpoint} names no actor.`);
  }
}

/** An admin-tier read made for a session that is no administrator's: a caller outside the admin guards. */
export class AdminReadWithoutAdministratorError extends Error {
  override name = "AdminReadWithoutAdministratorError";

  constructor() {
    super("An admin-tier read was made for a session that is no administrator's.");
  }
}

/**
 * A write the request's deadline refused before it was sent: nothing left, so it changed nothing, as
 * `fl_frontend/src/core/mail.ts :: MailUnsentError` says of a message. `FE-NET-001`, a call the network
 * never answered.
 */
export class ApiUnsentError extends Error {
  readonly code = "FE-NET-001";
  override name = "ApiUnsentError";

  constructor(method: string) {
    super(`The request's deadline had passed before this ${method} was sent.`);
  }
}

export class APIBadStatusError extends Error {
  readonly code = "FE-API-001";
  traceId: string;
  statusCode: number;
  serverErrorCode?: string;
  refusedFields: readonly FLRefusedField[];
  url: string;
  endpoint: string;
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
    serverErrorCode?: string;
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
 * The protocol's classes: a credential, a request the API cannot take, a route it does not serve. None is
 * a rule refusing what the request asked for, and each class grows codes the backend adds to it.
 */
const PROTOCOL_CLASS = /^REQ-(AUTH|VAL|ROUTE)-/;

/**
 * Whether a code is one a slice's mapper words: a rule's, or the unique index's `DB-COMMON-002`. By the
 * code's class alone, never its status: every other `DB-` code is the store answering, not a rule.
 */
export function isRefusalCode(code: string | undefined): boolean {
  if (code === undefined) return false;

  return code === "DB-COMMON-002" || (code.startsWith("REQ-") && !PROTOCOL_CLASS.test(code));
}

/**
 * Whether the API answered that the record a read names does not exist. By the code, never the status:
 * any other 404 is a route the framework did not serve (`REQ-ROUTE-001`) or the edge's own, a failure.
 */
export function isRecordMissing(error: unknown): boolean {
  return error instanceof APIBadStatusError && error.statusCode === 404 && error.serverErrorCode === "DB-COMMON-001";
}

export class APIMalformedDataError extends Error {
  readonly code = "FE-API-002";
  traceId: string;
  statusCode: number;
  url: string;
  endpoint: string;
  method: string;
  readOnly: boolean;

  constructor({
    message,
    url,
    statusCode,
    endpoint,
    method,
    readOnly,
    traceId,
    zodIssues,
  }: SentRequest & {
    message: string;
    url: string;
    statusCode: number;
    endpoint: string;
    traceId: string;
    zodIssues?: unknown;
  }) {
    const errorCause = zodIssues ? { zodIssues, traceId, url } : { traceId, url };
    super(message, { cause: errorCause });

    this.name = "APIMalformedDataError";
    this.traceId = traceId;
    this.statusCode = statusCode;
    this.url = url;
    this.endpoint = endpoint;
    this.method = method;
    this.readOnly = readOnly;
  }
}

export class APINetworkError extends Error {
  readonly code = "FE-NET-001";
  traceId: string;
  url: string;
  isTimeout: boolean;
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
  readonly code = "FE-MAIL-001";
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
