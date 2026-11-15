// The sign-in doubles' default lookup, which every suite registering them without an answer of its own relies on:
// it answers the administrator alone, and a read for anyone else fails the case unless the case answered it.
import { ADMIN_EMAIL, answerTheLookup, memoryAdapterDouble, memoryStore, ORIGIN, registerAuthDoubles } from "@/test-support/authDoubles.ts";
import { serveBackend } from "@/test-support/backend.ts";
import { afterEach, describe, expect, it } from "vitest";

/** An address no answer of this file names. */
const STRANGER = "fremde@example.org";

const STORE = "__flAuthDoublesStore";

const backend = serveBackend();
const outbox = registerAuthDoubles({ specifiers: { "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) } });
memoryStore(STORE);

// Imported after the doubles, as a suite's subject is.
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

describe("the default lookup", () => {
  it("answers the administrator's address with the grant", async () => {
    await sendCode(ADMIN_EMAIL);
    await backend.answered();

    expect(outbox.sent.map(({ to }) => to)).toStrictEqual([ADMIN_EMAIL]);
  });

  it.fails("fails the case reading any other address", async () => {
    await sendCode(STRANGER).catch(() => undefined);
  });
  it("fails the case reading any other address: the failure names it", () => {
    expect(failures.get("fails the case reading any other address")).toMatch(/nothing answered POST \/identity\/sign_in/);
  });

  it("fails nothing where the case names an outage, the gate then sending nothing", async () => {
    answerTheLookup(() => null);

    await sendCode(STRANGER).catch(() => undefined);

    expect(outbox.sent).toStrictEqual([]);
  });
});
