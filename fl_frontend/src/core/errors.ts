export class APIBadStatusError extends Error {
  readonly code = "FE-API-001";
  traceId: string;
  statusCode: number;
  serverErrorCode?: string;
  url: string;
  endpoint: string;

  constructor({
    message,
    url,
    statusCode,
    serverErrorCode,
    endpoint,
    traceId,
    originalError,
  }: {
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
  }
}

export class APIMalformedDataError extends Error {
  readonly code = "FE-API-002";
  traceId: string;
  statusCode: number;
  url: string;
  endpoint: string;

  constructor({
    message,
    url,
    statusCode,
    endpoint,
    traceId,
    zodIssues,
  }: {
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
  }
}

export class APINetworkError extends Error {
  readonly code = "FE-NET-001";
  traceId: string;
  url: string;
  isTimeout: boolean;

  constructor({
    message,
    url,
    traceId,
    isTimeout,
    originalError,
  }: {
    message: string;
    url: string;
    traceId: string;
    isTimeout: boolean;
    originalError?: unknown;
  }) {
    const errorCause = originalError ? { originalError, traceId, isTimeout, url } : { traceId, isTimeout, url };
    super(message, { cause: errorCause });

    this.name = "APINetworkError";
    this.traceId = traceId;
    this.url = url;
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
