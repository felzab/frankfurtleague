import { describe, expect, it } from "vitest";

import { BootRefusal } from "./bootRefusal";
import { judgedSettings } from "./config";

/** What `run` threw, so the refusal is compared whole: a second fault would add its name to the sentence. */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

const KEY = "k".repeat(64);

/** Production's environment as a deploy sets it, every variable well formed. */
const VARIABLES = {
  APP_ENV: "production",
  API_URL: "http://backend:8000",
  AUTH_URL: "https://league.example",
  TURNSTILE_SITE_KEY: "0x4AAAAAAAsiteKeyOfTheLeague",
};

/** Production's secret files, every one present and well formed. */
const FILES = {
  MONGODB_URI: "mongodb://store:27017",
  AUTH_SECRET: "s".repeat(32),
  AUTH_RESEND_KEY: "re_key",
  RESEND_WEBHOOK_SECRET: "whsec_key",
  INTERNAL_API_KEY_BASE: KEY,
  INTERNAL_API_KEY_SYSTEM: KEY,
  INTERNAL_API_KEY_ADMIN: KEY,
  TURNSTILE_SECRET_KEY: "0x4AAAAAAAsecretKeyOfTheLeague",
  BETTERSTACK_HEARTBEAT_URL: "https://uptime.example/heartbeat",
};

/*
 * Each rule refuses a production boot that would otherwise serve as though healthy: a test key passes every visitor, a
 * missing production secret leaves mail held, and an API_URL through the public origin answers the footer's probe alone.
 */
describe("a production boot", () => {
  it.each([
    [
      "on one of Cloudflare's test keys",
      VARIABLES,
      { ...FILES, TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" },
      "Invalid secret files: turnstile_secret_key",
    ],
    [
      "missing the files production alone demands",
      VARIABLES,
      {
        ...FILES,
        AUTH_RESEND_KEY: undefined,
        RESEND_WEBHOOK_SECRET: undefined,
        TURNSTILE_SECRET_KEY: undefined,
        BETTERSTACK_HEARTBEAT_URL: undefined,
      },
      "Invalid secret files: auth_resend_key, betterstack_heartbeat_url, resend_webhook_secret, turnstile_secret_key",
    ],
    [
      "reaching the backend through the public origin",
      { ...VARIABLES, API_URL: "https://league.example/api" },
      FILES,
      "Invalid environment variables: API_URL",
    ],
  ])("is refused %s", (_, variables, files, refusal) => {
    expect(thrownBy(() => judgedSettings(variables, files))).toStrictEqual(new BootRefusal(refusal));
  });
});
