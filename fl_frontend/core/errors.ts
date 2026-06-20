export class APIBadStatusError extends Error {
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
    originalError,
  }: {
    message: string;
    url: string;
    statusCode: number;
    endpoint: string;
    traceId: string;
    originalError?: unknown;
  }) {
    // Merge custom metadata into cause object while preserving original error trace if provided
    const errorCause = originalError ? { originalError, traceId, statusCode, url, endpoint } : { traceId, statusCode, url, endpoint };
    super(message, { cause: errorCause });

    this.name = "APIBadStatusError";
    this.traceId = traceId;
    this.statusCode = statusCode;
    this.url = url;
    this.endpoint = endpoint;
  }
}

export class APIMalformedDataError extends Error {
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
