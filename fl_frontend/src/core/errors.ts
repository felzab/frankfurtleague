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

export class MailSendError extends Error {
  readonly code = "FE-MAIL-001";
  correlationId: string;
  statusCode: number;
  providerErrorName?: string;
  url: string;

  constructor({
    message,
    url,
    statusCode,
    providerErrorName,
    correlationId,
  }: {
    message: string;
    url: string;
    statusCode: number;
    providerErrorName?: string;
    correlationId: string;
  }) {
    super(message, { cause: { correlationId, statusCode, providerErrorName, url } });

    this.name = "MailSendError";
    this.correlationId = correlationId;
    this.statusCode = statusCode;
    this.providerErrorName = providerErrorName;
    this.url = url;
  }
}
