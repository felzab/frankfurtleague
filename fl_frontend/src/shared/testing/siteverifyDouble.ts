import { beforeEach } from "node:test";

import { doubleFetch } from "./fetchDouble.ts";

/** Cloudflare's published site key that always passes, which every form a suite mounts is handed. */
export const TEST_SITE_KEY = "1x00000000000000000000AA";

/** What Cloudflare's published test site key mints (https://developers.cloudflare.com/turnstile/troubleshooting/testing/, read 2026-10-04). */
export const TEST_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/** The secret that verifies `TEST_TOKEN`, published on the same page, which every deployment but production boots with. */
export const TEST_SECRET = "1x0000000000000000000000000000000AA";

/**
 * Cloudflare's check at the network edge every suite fakes, judging every token a pass from each case's
 * start. Nothing behind the edge is faked here, so a case reads the token and secret each check was asked with.
 */
export function doubleSiteverify(): {
  /** Cloudflare's verdict on every check the case asks for from here on. */
  judges: (success: boolean) => void;
  /** Cloudflare answering no check at all. */
  unreachable: () => void;
  /** The secret and token of each check asked so far; the idempotency key is a fresh UUID per check. */
  asked: () => Record<string, unknown>[];
} {
  const fetches = doubleFetch();

  const judges = (success: boolean): void => {
    fetches.mock.mockImplementation(async () => Response.json({ success: success, "error-codes": success ? [] : ["invalid-input-response"] }));
  };

  // After the fetch double's own hook, which hands each case a fresh double to answer on.
  beforeEach(() => judges(true));

  return {
    judges,
    unreachable: () => {
      fetches.mock.mockImplementation(async () => {
        throw new TypeError("fetch failed");
      });
    },
    asked: () =>
      fetches.mock.calls.map((call) => {
        const { secret, response } = JSON.parse(String(call.arguments[1]?.body)) as Record<string, unknown>;
        return { secret, response };
      }),
  };
}
