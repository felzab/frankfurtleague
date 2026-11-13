import { ADMIN_EMAIL, ORIGIN, signInByCode } from "@/test-support/authDoubles.ts";
import { serveBackend } from "@/test-support/backend.ts";
import { signedInRequest } from "@/test-support/session.ts";
import { captureLog } from "@/test-support/stdoutCapture.ts";
import { assert, describe, expect, it } from "vitest";

// Under the production build's `NODE_ENV` (`fl_frontend/vitest.config.mts :: PRODUCTION_BUILD`): only its format writes
// a line's `trace_id`, which this file holds the sign-in's two lines to.

serveBackend();
const { store } = signedInRequest();
/** Every line the real logger writes, read off standard output. */
const log = captureLog();

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const { auth } = await import("./auth/library.ts");

/** A code of the right shape that is not `otp`. */
const wrongFor = (otp: string): string => (otp === "000000" ? "111111" : "000000");

/** The trace a document carries, which `LoggedLine` sets aside as the plain format writes none. */
const traceOf = (raw: string): unknown => (JSON.parse(raw) as { trace_id?: unknown }).trace_id;

/* Who signed in is recorded nowhere else, and the edge's line the trace joins holds where from: the two lines carry the
   account's id and the trace, and never the address typed. */
describe("the sign-in's own lines", () => {
  const TRACE = "5".repeat(32);
  const TRACED = { ...ORIGIN, traceparent: `00-${TRACE}-${"6".repeat(16)}-01` };

  it("writes a sign-in by its account and factor, and a refused code by its trace, never the address", async () => {
    // The file's visitor was signed in before the case, on a line of its own.
    log.clear();
    await signInByCode(auth, ADMIN_EMAIL, TRACED);
    const userId = store.session.at(-1)?.userId;
    const otp = await auth.api.createVerificationOTP({ body: { email: ADMIN_EMAIL, type: "sign-in" } });
    await auth.api.signInEmailOTP({ body: { email: ADMIN_EMAIL, otp: wrongFor(otp) }, headers: new Headers(TRACED) }).catch(() => undefined);

    const lines = log.lines().filter(({ message }) => message === "auth.signed_in" || message === "auth.code_refused");
    expect(lines.map(({ level, message, fields, raw }) => [level, message, { ...fields, trace_id: traceOf(raw) }])).toStrictEqual([
      ["INFO", "auth.signed_in", { user_id: userId, factor: "code", trace_id: TRACE }],
      ["INFO", "auth.code_refused", { trace_id: TRACE }],
    ]);
    // The logger scrubs an address it meets, so a line carrying one reads as its placeholder.
    assert.ok(
      userId !== undefined && !lines.some(({ raw }) => raw.includes(ADMIN_EMAIL) || raw.includes("[address]")),
      "the address reached a sign-in line",
    );
  });
});
