import type { Code, FLRefusedField } from "./generated/client/types";

/** A call as `mayHaveWritten` judges it: its method, and whether its operation's contract marks it read-only. */
export type SentRequest = {
  method: string;
  /** A call changing nothing whatever its method says, as its operation's contract states. */
  readOnly: boolean;
};

/**
 * RFC 9110's safe methods: a request of one changes nothing on the server, however it ended. Its
 * fourth, TRACE, is one `fetch` refuses to send.
 */
const SAFE_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD", "OPTIONS"]);

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
 * An admin-tier read whose grant the backend left unread: an outage, answered by the admin boundary's
 * retry, never a sign-in, which would meet the same unread grant.
 */
export class UnreadGrantError extends Error {
  override name = "UnreadGrantError";

  constructor() {
    super("The backend left the administrator's grant unread.");
  }
}

export class APIBadStatusError extends Error {
  override name = "APIBadStatusError";
  readonly traceId: string;
  readonly statusCode: number;
  readonly serverErrorCode?: Code;
  readonly refusedFields: readonly FLRefusedField[];

  constructor({
    message,
    statusCode,
    serverErrorCode,
    refusedFields = [],
    traceId,
  }: {
    message: string;
    statusCode: number;
    serverErrorCode?: Code;
    refusedFields?: readonly FLRefusedField[];
    traceId: string;
  }) {
    super(message);

    this.traceId = traceId;
    this.statusCode = statusCode;
    this.serverErrorCode = serverErrorCode;
    this.refusedFields = refusedFields;
  }
}

/**
 * The API's refusal of the request, which every mapper but the action's reads before the code, `null` for any other
 * error: a 4xx, at whatever status the code's rule answers with. Never a 5xx, after which a write may have landed. The
 * action's mapper judges by the code alone, whatever its status, since it words a 5xx's code too, on the shared
 * failure line.
 */
export function asRefusal(error: unknown): APIBadStatusError | null {
  return error instanceof APIBadStatusError && error.statusCode >= 400 && error.statusCode < 500 ? error : null;
}

/** Whether the API refused the request, as `asRefusal` reads a refusal, with one of `codes`. */
export function refusedAs(error: unknown, codes: ReadonlySet<Code>): boolean {
  const code = asRefusal(error)?.serverErrorCode;
  return code !== undefined && codes.has(code);
}

/**
 * Whether the API answered that the record a read names does not exist. By the code, never the status:
 * any other 404 is a route the framework did not serve (`no_route`) or the edge's own, a failure.
 */
function isRecordMissing(error: unknown): boolean {
  return error instanceof APIBadStatusError && error.statusCode === 404 && error.serverErrorCode === "document_not_found";
}

/**
 * A read's answer, `null` where the API answered that the record it names does not exist, which its page says as not
 * found. Called inside a `"use cache"` scope, never around one: an error thrown out of a scope reaches its caller
 * redacted to a digest, which nothing can recognise.
 */
export const orMissing = <Read>(read: Promise<Read>): Promise<Read | null> =>
  read.catch((error: unknown) => {
    if (isRecordMissing(error)) return null;
    throw error;
  });

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
  override name = "APINetworkError";
  readonly traceId: string;

  constructor({ message, traceId, originalError }: { message: string; traceId: string; originalError?: unknown }) {
    // The failure `fetch` threw, as the standard cause: the one place it appears in the error Next prints.
    super(message, { cause: originalError });

    this.traceId = traceId;
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
 * The two 409s Resend's error reference tells a caller to try again later, a repeat of a send still in progress and a
 * resource held by another request. Every other 409 names a request no repeat repairs, `invalid_idempotent_request`
 * among them (<https://resend.com/docs/api-reference/errors>).
 */
const TRANSIENT_CONFLICTS: ReadonlySet<string> = new Set(["concurrent_idempotent_requests", "resource_locked"]);

export class MailSendError extends Error {
  override name = "MailSendError";
  readonly traceId: string;
  readonly statusCode: number;
  readonly providerErrorName?: string;

  /**
   * Whether a second attempt could land. By the status for a rate limit, a quota and an outage, which the reference
   * answers at 429 and at 500 or above whatever their name, so a name it adds there is retried too; by the name for
   * the two temporary conflicts.
   */
  get isTransient(): boolean {
    if (this.statusCode === 429 || this.statusCode >= 500) return true;

    return this.providerErrorName !== undefined && TRANSIENT_CONFLICTS.has(this.providerErrorName);
  }

  constructor({
    message,
    statusCode,
    providerErrorName,
    traceId,
  }: {
    message: string;
    statusCode: number;
    providerErrorName?: string;
    traceId: string;
  }) {
    super(message);

    this.traceId = traceId;
    this.statusCode = statusCode;
    this.providerErrorName = providerErrorName;
  }
}
