// The session helper's own guarantee, which every signed-in suite relies on and none tests: what the sign-in library
// owes is on record, and a lookup no case answered fails its case.
import { ADMIN_EMAIL, answerTheLookup, ORIGIN } from "@/test-support/authDoubles.ts";
import { serveBackend } from "@/test-support/backend.ts";
import { signedInRequest } from "@/test-support/session.ts";
import { afterEach, describe, expect, it } from "vitest";

/** An address the file answers no lookup for. */
const STRANGER = "fremde@example.org";

const backend = serveBackend();
const { outbox } = signedInRequest();

// Imported after the helper's doubles, as a suite's subject is.
const { auth } = await import("@/core/auth/library.ts");

/** Asks the sign-in library to mail `email` a code, as the sign-in page's send does. */
const sendCode = (email: string) => auth.api.sendVerificationOTP({ body: { email, type: "sign-in" }, headers: new Headers(ORIGIN) });

/** Each case's failure messages, read once every hook of the case, the setup file's last among them, has run. */
const failures = new Map<string, string>();
afterEach(({ task, onTestFinished: finished }) => {
  finished(() => {
    failures.set(task.name, (task.result?.errors ?? []).map(({ message }) => String(message)).join("\n"));
  });
});

describe("what the sign-in library owes", () => {
  it("is on the outbox record the helper hands back, and its request in `served`", async () => {
    await sendCode(ADMIN_EMAIL);
    await backend.answered();

    expect(outbox.sent.map(({ to }) => to)).toStrictEqual([ADMIN_EMAIL]);
    expect(backend.served.map(({ method, path }) => `${method} ${path}`)).toContain("POST /outbox/sign_in");
    expect(backend.sent, "a standing answer's request handed to the case's answer").toStrictEqual([]);
  });
});

describe("a lookup for an address the case did not answer", () => {
  it.fails("fails the case", async () => {
    await sendCode(STRANGER).catch(() => undefined);
  });
  it("fails the case: the failure names it", () => {
    expect(failures.get("fails the case")).toMatch(/nothing answered POST \/identity\/sign_in/);
  });

  it("fails nothing where the case names an outage, the gate then sending nothing", async () => {
    answerTheLookup(() => null);

    await sendCode(STRANGER).catch(() => undefined);

    expect(outbox.sent).toStrictEqual([]);
  });
});
