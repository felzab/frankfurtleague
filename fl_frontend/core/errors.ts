export class APIBadStatusError extends Error {
  public statusCode: number;
  public errorCode?: string;
  public errorMessage?: string;
  public url: string;

  constructor({
    message,
    url,
    statusCode,
    errorCode,
    errorMessage,
  }: {
    message: string;
    url: string;
    statusCode: number;
    errorCode?: string;
    errorMessage?: string;
  }) {
    super(message);

    Object.setPrototypeOf(this, APIBadStatusError.prototype);

    this.name = "APIBadStatusError";
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    this.errorMessage = errorMessage;
    this.url = url;
  }
}

export class APINetworkError extends Error {
  public url: string;
  public errorDetails: { message: string; cause: unknown };

  constructor({ message, url, errorDetails }: { message: string; url: string; errorDetails: { message: string; cause: unknown } }) {
    super(message);

    Object.setPrototypeOf(this, APINetworkError.prototype);

    this.name = "APINetworkError";
    this.url = url;
    this.errorDetails = errorDetails;
  }
}
