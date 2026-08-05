/**
 * CORE · typed API errors
 *
 * Three failure kinds, kept distinct because they point at different systems: the network did not
 * answer, the API answered with a bad status, or the API answered with something unparseable.
 *
 * Collapsing them loses the diagnosis. Reporting a malformed body as a network failure sends the
 * reader to check connectivity when the problem is a schema mismatch.
 *
 * Every error carries a stable `code` (the `FE-*` half of the table in `docs/logging.md`) and the
 * `correlationId` sent as `X-Correlation-ID`, so a frontend error can be matched to the backend log
 * line for the same request. A bad status additionally carries `serverErrorCode` — the backend's
 * own code, read off the response body — which is what lets a caller distinguish "shorthand already
 * taken" (DB-COMMON-002) from a crash without parsing prose.
 */

export class APIBadStatusError extends Error {
  readonly code = "FE-API-001";
  correlationId: string;
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
    correlationId,
    originalError,
  }: {
    message: string;
    url: string;
    statusCode: number;
    serverErrorCode?: string;
    endpoint: string;
    correlationId: string;
    originalError?: unknown;
  }) {
    // Merge custom metadata into cause object while preserving original error trace if provided
    const errorCause = originalError
      ? { originalError, correlationId, statusCode, serverErrorCode, url, endpoint }
      : { correlationId, statusCode, serverErrorCode, url, endpoint };
    super(message, { cause: errorCause });

    this.name = "APIBadStatusError";
    this.correlationId = correlationId;
    this.statusCode = statusCode;
    this.serverErrorCode = serverErrorCode;
    this.url = url;
    this.endpoint = endpoint;
  }
}

export class APIMalformedDataError extends Error {
  readonly code = "FE-API-002";
  correlationId: string;
  statusCode: number;
  url: string;
  endpoint: string;

  constructor({
    message,
    url,
    statusCode,
    endpoint,
    correlationId,
    zodIssues,
  }: {
    message: string;
    url: string;
    statusCode: number;
    endpoint: string;
    correlationId: string;
    zodIssues?: unknown;
  }) {
    const errorCause = zodIssues ? { zodIssues, correlationId, url } : { correlationId, url };
    super(message, { cause: errorCause });

    this.name = "APIMalformedDataError";
    this.correlationId = correlationId;
    this.statusCode = statusCode;
    this.url = url;
    this.endpoint = endpoint;
  }
}

export class APINetworkError extends Error {
  readonly code = "FE-NET-001";
  correlationId: string;
  url: string;
  isTimeout: boolean;

  constructor({
    message,
    url,
    correlationId,
    isTimeout,
    originalError,
  }: {
    message: string;
    url: string;
    correlationId: string;
    isTimeout: boolean;
    originalError?: unknown;
  }) {
    const errorCause = originalError ? { originalError, correlationId, isTimeout, url } : { correlationId, isTimeout, url };
    super(message, { cause: errorCause });

    this.name = "APINetworkError";
    this.correlationId = correlationId;
    this.url = url;
    this.isTimeout = isTimeout;
  }
}
