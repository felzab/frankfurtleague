// The session helper's own guarantee, which every signed-in suite relies on and none tests: what the sign-in library
// owes is on record, a lookup no case answered fails its case, and nothing one case did reaches the next.
import { describe, expect, it } from "vitest";

import { ADMIN_EMAIL, answerTheLookup, ORIGIN } from "@/test-support/authDoubles";
import { serveBackend } from "@/test-support/backend";
import { caseFailures } from "@/test-support/caseFailures";
import { signedInRequest } from "@/test-support/session";
import { TEST_SECRETS } from "@/test-support/testEnvironment.mts";

/** An address the file answers no lookup for. */
const STRANGER = "fremde@example.org";

const backend = serveBackend();
const { arriveAs, store, outbox } = signedInRequest();

// Imported after the helper's doubles, as a suite's subject is.
const { auth } = await import("@/core/auth/library");
const { cookies } = await import("next/headers");
const { frontend_config, internalApiKeyAdmin } = await import("@/core/config");

/** Asks the sign-in library to mail `email` a code, as the sign-in page's send does. */
const sendCode = (email: string) => auth.api.sendVerificationOTP({ body: { email, type: "sign-in" }, headers: new Headers(ORIGIN) });

const { failsNaming } = caseFailures();

describe("the request", () => {
  it("runs under the real config, over the run's environment and its secret files", () => {
    // The environment's name, which no stand-in of the config carries, and a key read off the run's own file.
    expect(frontend_config.APP_ENV).toBe("local");
    expect(internalApiKeyAdmin()).toBe(TEST_SECRETS.internal_api_key_admin);
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
  failsNaming("fails the case", /nothing answered POST \/identity\/sign_in/, async () => {
    await sendCode(STRANGER).catch(() => undefined);
  });

  it("fails nothing where the case names an outage, the gate then sending nothing", async () => {
    answerTheLookup(() => null);

    await sendCode(STRANGER).catch(() => undefined);

    expect(outbox.sent).toStrictEqual([]);
  });

  it("is answered again by the file's own answer in the next case, the outage gone", () => {
    // This case's arrival signed the administrator in over the file's answer; an outage left over refuses it.
    expect(store.session).toHaveLength(1);
  });
});

describe("the sign-in store", () => {
  it("holds a case's own arrival alone, after another case's", () => {
    expect(store.session).toHaveLength(1);
    expect(store.user.map(({ email }) => email)).toStrictEqual([ADMIN_EMAIL]);
  });
});

describe("a cookie the code wrote", () => {
  it("is gone once the visitor changes", async () => {
    (await cookies()).set("written-by-the-code", "for-the-administrator");

    await arriveAs(null);

    expect((await cookies()).get("written-by-the-code")).toBeUndefined();
  });
});
