import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { beforeEach, describe, it, mock } from "node:test";
import { inspect } from "node:util";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

const LOG_RECORDER = "__flMailLogLines";

// Replaced at the module boundary rather than the transport being reshaped to admit a seam: the key
// the real config reads is a credential no test run holds, so the transport would authorise every
// send below with `Bearer undefined`.
const CONFIG_DOUBLE = `export const frontend_config = { AUTH_RESEND_KEY: "resend-key-double" };`;

const LOGGER_DOUBLE = `export const logger = {
  info: (message, meta) => globalThis.${LOG_RECORDER}.push({ message, meta }),
  warn: (message, meta) => globalThis.${LOG_RECORDER}.push({ message, meta }),
  error: (message, error, meta) => globalThis.${LOG_RECORDER}.push({ message, error, meta }),
};`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) return { format: "module", source: CONFIG_DOUBLE, shortCircuit: true };
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGER_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

/** What the doubled logger was handed. `error` is the second argument, which must stay absent. */
type RecordedLine = { message: string; error?: unknown; meta?: Record<string, unknown> };

const logs: RecordedLine[] = [];
(globalThis as unknown as Record<string, RecordedLine[]>)[LOG_RECORDER] = logs;

const { sendMail } = await import("./mail.ts");
const { APINetworkError, MailSendError } = await import("./errors.ts");

const SRC_ROOT = path.resolve(import.meta.dirname, "..");
const MAIL_MODULE = path.join(import.meta.dirname, "mail.ts");
const PROVIDER_ENDPOINT = "https://api.resend.com/emails";

/* The sweep below matches a pattern rather than containing a substring: a URL used as a containment
   needle reads as a hostname check to static analysis, which is a real defect in a URL guard and
   noise in a source scan. */
const PROVIDER_ENDPOINT_PATTERN = /https:\/\/api\.resend\.com\/emails/;

/** The module's own timeout, restated so a change to it has to be made here too. */
const MAIL_TIMEOUT_MS = 15000;

/** What the doubled transport was asked to send, and on what terms. */
type RecordedSend = { url: string; init: RequestInit };

const sends: RecordedSend[] = [];
let respond: () => Promise<Response>;

// Honours the signal as the real `fetch` does, so a test can abort a send that never answers.
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  sends.push({ url: String(input), init: init ?? {} });

  const signal = init?.signal;
  if (!signal) return respond();

  return await Promise.race([
    respond(),
    new Promise<Response>((_, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    }),
  ]);
}) as typeof fetch;

const MESSAGE = { to: "trainer@example.org", subject: "Anmeldelink", html: "<p>Hallo</p>", text: "Hallo" };

const jsonResponse = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status: status, headers: { "content-type": "application/json" } });

const refusalBody = () => ({ name: "validation_error", message: `Invalid \`to\` field: ${MESSAGE.to}` });

/** The one request `sendMail` drew, failing rather than returning `undefined` if it drew none. */
async function sentRequest(): Promise<RecordedSend> {
  await sendMail(MESSAGE);
  assert.equal(sends.length, 1, `expected exactly one request, saw ${sends.length}`);

  return sends[0]!;
}

async function refusalFrom(respondWith: () => Promise<Response>): Promise<Error> {
  respond = respondWith;

  try {
    await sendMail(MESSAGE);
  } catch (error) {
    assert.equal(sends.length, 1, `expected the refusal to follow one request, saw ${sends.length}`);
    return error as Error;
  }

  return assert.fail("the send resolved where it was expected to throw");
}

/* `inspect` rather than a hand-listed set through `JSON.stringify`, which renders a nested `Error`
   as `{}` and drops every non-enumerable field -- so the shape most likely to carry the address
   would be the one it could not see. */
function assertHidesRecipient(subject: unknown, where: string): void {
  const carried = inspect(subject, { depth: null });
  assert.ok(!carried.includes(MESSAGE.to), `${where} carried the recipient: ${carried}`);
}

describe("the mail transport", () => {
  beforeEach(() => {
    sends.length = 0;
    logs.length = 0;
    respond = async () => jsonResponse({ id: "01HZ" }, 200);
  });

  /* First, so a double that never ran fails here rather than under every assertion below. */
  it("posts one request to the provider's send endpoint", async () => {
    const sent = await sentRequest();

    assert.equal(sent.url, PROVIDER_ENDPOINT);
    assert.equal(sent.init.method, "POST");
  });

  it("authorises with the key the validated environment holds, never one passed in by a caller", async () => {
    const sent = await sentRequest();
    const headers = sent.init.headers as Record<string, string>;

    assert.equal(headers["Authorization"], "Bearer resend-key-double");
    assert.equal(headers["Content-Type"], "application/json");
  });

  it("sends both bodies under the one sender address the module owns", async () => {
    const sent = await sentRequest();
    const body = JSON.parse(String(sent.init.body)) as Record<string, string>;

    assert.deepEqual(Object.keys(body).sort(), ["from", "html", "subject", "text", "to"]);
    assert.equal(body["from"], "no-reply@frankfurtleague.de");
    assert.equal(body["to"], MESSAGE.to);
    assert.equal(body["html"], MESSAGE.html);
    assert.equal(body["text"], MESSAGE.text);
  });

  it("says nothing at all when the provider accepts the message", async () => {
    await sentRequest();

    assert.deepEqual(logs, []);
  });

  it("aborts a send that never answers, and not one millisecond before its timeout", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });

    try {
      respond = () => new Promise<Response>(() => {});
      const pending = sendMail(MESSAGE);
      const signal = sends[0]!.init.signal as AbortSignal;

      mock.timers.tick(MAIL_TIMEOUT_MS - 1);
      assert.equal(signal.aborted, false, "the send was aborted before its timeout elapsed");

      mock.timers.tick(1);
      assert.equal(signal.aborted, true, "the timeout elapsed and the send was not aborted");

      const error = await pending.then(
        () => assert.fail("the aborted send resolved"),
        (thrown: Error) => thrown,
      );

      assert.ok(error instanceof APINetworkError);
      assert.equal(error.isTimeout, true);
      assertHidesRecipient(error, "the timeout");
    } finally {
      mock.timers.reset();
    }
  });

  it("takes the provider's stable code from a refusal and never its prose message", async () => {
    const error = await refusalFrom(async () => jsonResponse(refusalBody(), 422));

    assert.ok(error instanceof MailSendError);
    assert.equal(error.statusCode, 422);
    assert.equal(error.providerErrorName, "validation_error");
  });

  it("keeps the recipient out of a refusal, which is the reason the prose message is dropped", async () => {
    const error = await refusalFrom(async () => jsonResponse(refusalBody(), 422));

    assertHidesRecipient(error, "the refusal");
  });

  it("logs the refusal under its own code, with the status and the provider's code", async () => {
    await refusalFrom(async () => jsonResponse(refusalBody(), 422));

    assert.equal(logs.length, 1, `expected exactly one log line, saw ${logs.length}`);
    assert.equal(logs[0]!.meta?.["error_code"], "FE-MAIL-001");
    assert.equal(logs[0]!.meta?.["status_code"], 422);
    assert.equal(logs[0]!.meta?.["provider_error_name"], "validation_error");
    assert.match(String(logs[0]!.meta?.["correlation_id"]), /^[a-f0-9]{8,64}$/);
  });

  /* `docs/logging/spec.md :: L9` names a field and never the value submitted for it, and the
     recipient is the value here. Asserted on the whole line, so a later field cannot reopen it. */
  it("names no recipient on the line it logs", async () => {
    await refusalFrom(async () => jsonResponse(refusalBody(), 422));

    assert.equal(logs[0]!.error, undefined, "the error object reached the log, carrying its message and stack");
    assertHidesRecipient(logs[0], "the log line");
  });

  it("reports a connection failure as a network error that is not a timeout", async () => {
    const error = await refusalFrom(async () => {
      throw new TypeError("fetch failed");
    });

    assert.ok(error instanceof APINetworkError);
    assert.equal(error.isTimeout, false);
    assert.equal(logs.length, 1, `expected exactly one log line, saw ${logs.length}`);
    assert.equal(logs[0]!.meta?.["error_code"], "FE-NET-001");
    assertHidesRecipient(error, "the network failure");
  });

  it("reports a refusal whose body stalls as a timeout, not as a status with no provider code", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });

    try {
      respond = async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const signal = sends[0]!.init.signal as AbortSignal;
              signal.addEventListener("abort", () => controller.error(Object.assign(new Error("aborted"), { name: "AbortError" })));
            },
          }),
          { status: 502, headers: { "content-type": "application/json" } },
        );

      const pending = sendMail(MESSAGE);
      await new Promise((resolve) => setImmediate(resolve));
      mock.timers.tick(MAIL_TIMEOUT_MS);

      const error = await pending.then(
        () => assert.fail("the stalled body resolved"),
        (thrown: Error) => thrown,
      );

      assert.ok(error instanceof APINetworkError);
      assert.equal(error.isTimeout, true);
    } finally {
      mock.timers.reset();
    }
  });

  it("refuses on a bad status whose body is not JSON, rather than failing to parse it", async () => {
    const error = await refusalFrom(async () => new Response("<html>502</html>", { status: 502 }));

    assert.ok(error instanceof MailSendError);
    assert.equal(error.statusCode, 502);
    assert.equal(error.providerErrorName, undefined);
  });

  /* Read out of the source, because the harness above neutralises `server-only` for the whole
     process and a runtime assertion could not tell a present guard from an absent one. */
  it("guards the module as server-only, the key it reads being a credential", () => {
    assert.match(readFileSync(MAIL_MODULE, "utf8"), /^import "server-only";/);
  });

  it("is the only place in the frontend that names the provider's endpoint", () => {
    assert.match(PROVIDER_ENDPOINT, PROVIDER_ENDPOINT_PATTERN, "the sweep's pattern and the asserted endpoint disagree");

    const naming = readdirSync(SRC_ROOT, { recursive: true, encoding: "utf8" })
      .filter((entry) => entry.endsWith(".ts") || entry.endsWith(".tsx"))
      .filter((entry) => PROVIDER_ENDPOINT_PATTERN.test(readFileSync(path.join(SRC_ROOT, entry), "utf8")))
      .map((entry) => entry.split(path.sep).join("/"))
      .sort();

    assert.deepEqual(naming, ["core/mail.test.ts", "core/mail.ts"]);
  });
});
