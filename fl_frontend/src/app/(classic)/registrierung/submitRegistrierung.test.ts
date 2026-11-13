import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";
import { ROUTES } from "@/core/routes";
import { TURNSTILE_FIELD } from "@/core/turnstileToken";

const link = vi.hoisted(() => ({ forget: vi.fn<(page: string) => Promise<void>>(async () => undefined) }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
// Cloudflare's own verdict, which `core/turnstile.test.ts` judges.
vi.mock("@/core/turnstile", () => ({ turnstileRefusal: async () => null }));
// The cookie the proxy set, which only Next's request scope holds.
vi.mock("@/core/mailedLink", () => ({ forgetMailedLink: link.forget }));

const { calls } = doubleApiAnswers(() => Promise.resolve({ registrierung_id: "6890a1b2c3d4e5f607190001" }));

// Both after the double: the page's module reads the link's view through the generated client too.
const { submitRegistrierung } = await import("./submitRegistrierung");
const { REPLAY_FIELD } = await import("./invitation");

const KEY = "3f2b8c1e-7a4d-4e6f-9b1a-2c3d4e5f6a7b";
const TOKEN = "not-a-real-token";

/** The form as the browser posts it, the optional boxes left untouched. */
const BOXES: Readonly<Record<string, string>> = {
  act: "primary",
  token: TOKEN,
  [REPLAY_FIELD]: KEY,
  [TURNSTILE_FIELD]: "token",
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

beforeEach(() => {
  link.forget.mockClear();
});

describe("the registration a press sends", () => {
  // The harm: a press whose answer was lost, sent again under another key, is a second registration and a second mail;
  // an untouched optional box sent as "" is refused by the write's pattern, on a box the pupil never filled in.
  it("sends the form's replay key and the boxes as the write spells them, forgets the link once done, and leads on", async () => {
    const thrown: unknown = await submitRegistrierung(posted(BOXES)).catch((error: unknown) => error);
    // Next's redirect, thrown past the action, names the done page; the link's own page would read the forgotten link.
    const [kind, , address] = (thrown instanceof Error && "digest" in thrown ? String(thrown.digest) : "").split(";");
    expect([kind, address]).toStrictEqual(["NEXT_REDIRECT", ROUTES.registrierungDone.path()]);

    expect(calls[0]?.headers.get(IDEMPOTENCY_KEY_HEADER)).toBe(KEY);
    expect(requestsOf(calls)[0]?.body).toStrictEqual({
      token: TOKEN,
      first_name: "Mia",
      last_name: "Sommer",
      email: "mia@schule.de",
      nummer: null,
      position: null,
      stufe: null,
    });
    // The next person at a shared browser opening the plain address meets no earlier pupil's link.
    expect(link.forget).toHaveBeenCalledWith(ROUTES.registrierung.path());
  });
});
