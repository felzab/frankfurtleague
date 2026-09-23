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

export class APIBadStatusError extends Error {
  readonly code = "FE-API-001";
  traceId: string;
  statusCode: number;
  serverErrorCode?: string;
  url: string;
  endpoint: string;
  method: string;
  readOnly: boolean;

  constructor({
    message,
    url,
    statusCode,
    serverErrorCode,
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
    this.url = url;
    this.endpoint = endpoint;
    this.method = method;
    this.readOnly = readOnly;
  }
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
