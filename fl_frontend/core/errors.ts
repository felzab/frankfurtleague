export class APIBadStatusError extends Error {
  constructor({ message, url, statusCode, traceId }: { message: string; url: string; statusCode: number; traceId: string }) {
    super(message, { cause: { traceId, url, statusCode } });

    Object.setPrototypeOf(this, APIBadStatusError.prototype);
    this.name = "APIBadStatusError";
  }
}

export class APINetworkError extends Error {
  constructor({ message, url, traceId }: { message: string; url: string; traceId: string }) {
    super(message, { cause: { traceId, url } });

    Object.setPrototypeOf(this, APINetworkError.prototype);
    this.name = "APINetworkError";
  }
}
