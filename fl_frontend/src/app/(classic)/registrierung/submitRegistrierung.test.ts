import { serveBackend, serveHost } from "@/test-support/backend";
import { doubleNextRequest, writtenCookies } from "@/test-support/nextRequest";
import { describe, expect, it } from "vitest";

import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";
import { ROUTES } from "@/core/routes";
import { TURNSTILE_FIELD } from "@/core/turnstileToken";

import type { FLPostRegistrierungResponse } from "@/core/generated/client/types";

/** What Cloudflare's published test site key mints (https://developers.cloudflare.com/turnstile/troubleshooting/testing/). */
const BOT_CHECK_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

// Cloudflare's verdict, asked over the network by the real bot check: it passes the token the form posts, and answers
// nothing else, which fails the case.
const siteverify = serveHost("https://challenges.cloudflare.com", ({ method, url, body }) =>
  method === "POST" && url.pathname === "/turnstile/v0/siteverify" && (body as { response?: string }).response === BOT_CHECK_TOKEN
    ? { success: true, "error-codes": [] }
    : undefined,
);
// The registration's one write, answered as the backend stores it.
const backend = serveBackend(({ method, path }) =>
  method === "POST" && path === "/registrierungen"
    ? ({ registrierung_id: "6890a1b2c3d4e5f607190001" } satisfies FLPostRegistrierungResponse)
    : undefined,
);
doubleNextRequest();

// Both after the doubles: the page's module reads the link's view through the generated client too.
const { submitRegistrierung } = await import("./submitRegistrierung");
const { REPLAY_FIELD } = await import("./invitation");

const KEY = "3f2b8c1e-7a4d-4e6f-9b1a-2c3d4e5f6a7b";
const TOKEN = "not-a-real-token";

/** The form as the browser posts it, the optional boxes left untouched. */
const BOXES: Readonly<Record<string, string>> = {
  act: "primary",
  token: TOKEN,
  [REPLAY_FIELD]: KEY,
  [TURNSTILE_FIELD]: BOT_CHECK_TOKEN,
  first_name: "Mia",
  last_name: "Sommer",
  email: "mia@schule.de",
  nummer: "",
  position: "",
  stufe: "",
};

const posted = (entries: Readonly<Record<string, string>>) => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(entries)) formData.set(name, value);
  return formData;
};

describe("the registration a press sends", () => {
  // The harm: a press whose answer was lost, sent again under another key, is a second registration and a second mail;
  // an untouched optional box sent as "" is refused by the write's pattern, on a box the pupil never filled in.
  it("sends the form's replay key and the boxes as the write spells them, forgets the link once done, and leads on", async () => {
    const thrown: unknown = await submitRegistrierung(posted(BOXES)).catch((error: unknown) => error);
    // Next's redirect, thrown past the action, names the done page; the link's own page would read the forgotten link.
    const [kind, , address] = (thrown instanceof Error && "digest" in thrown ? String(thrown.digest) : "").split(";");
    expect([kind, address]).toStrictEqual(["NEXT_REDIRECT", ROUTES.registrierungDone.path()]);

    expect(siteverify).toHaveLength(1);
    expect(backend.sent.map(({ method, path }) => `${method} ${path}`)).toStrictEqual(["POST /registrierungen"]);
    expect(backend.sent[0]?.headers.get(IDEMPOTENCY_KEY_HEADER)).toBe(KEY);
    expect(backend.sent[0]?.body).toStrictEqual({
      token: TOKEN,
      first_name: "Mia",
      last_name: "Sommer",
      email: "mia@schule.de",
      nummer: null,
      position: null,
      stufe: null,
    });
    // The next person at a shared browser opening the plain address meets no earlier pupil's link: its cookie is
    // deleted on the registration's own path, the path it was set on, carrying no value and expired at the epoch.
    expect(writtenCookies().map(({ name, value, path, expires }) => ({ name, value, path, expires }))).toStrictEqual([
      { name: "mailed_link", value: undefined, path: ROUTES.registrierung.path(), expires: new Date(0) },
    ]);
  });
});
