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

export class MailSendError extends Error {
  readonly code = "FE-MAIL-001";
  traceId: string;
  statusCode: number;
  providerErrorName?: string;
  url: string;

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
