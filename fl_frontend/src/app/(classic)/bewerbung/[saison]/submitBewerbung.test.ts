import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { IDEMPOTENCY_KEY_FIELD, IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";
import { TURNSTILE_FIELD } from "@/core/turnstileToken";
import { serveBackend, serveHost } from "@/test-support/backend";
import { doubleNextRequest } from "@/test-support/nextRequest";
import { posted } from "@/test-support/posted";

import { SUBMITTED } from "./ends";

import type { FLCreatedResponse } from "@/core/generated/client/types";

/** The token the form posts, which Cloudflare judges. */
const TOKEN = "token";

const CLOUDFLARE = "https://challenges.cloudflare.com";

/**
 * Cloudflare's check, answered with `verdict` on its own address for the form's own token alone: the real
 * `core/turnstile.ts` asks it.
 */
const judging =
  (verdict: { success: boolean; "error-codes": string[] }) =>
  ({ method, url, body }: { method: string; url: URL; body: unknown }) => {
    if (method !== "POST" || url.pathname !== "/turnstile/v0/siteverify") return undefined;
    return (body as { response?: string } | undefined)?.response === TOKEN ? verdict : undefined;
  };

// Passed in every case but one that serves its own refusal.
serveHost(CLOUDFLARE, judging({ success: true, "error-codes": [] }));
// The application's one write; anything else is unanswered and fails the case.
const backend = serveBackend(({ method, path }) =>
  method === "POST" && path === "/bewerbungen" ? ({ created_id: "6890a1b2c3d4e5f607190001" } satisfies FLCreatedResponse) : undefined,
);
// A visitor with no session: the public lane reads no sign-in, only the request.
doubleNextRequest();

const { submitBewerbung } = await import("./submitBewerbung");
const { boxRulesOf } = await import("@/core/action");

const KEY = "3f2b8c1e-7a4d-4e6f-9b1a-2c3d4e5f6a7b";
const TEAM = "6890a1b2c3d4e5f607190002";

const seat = (name: string, first: string, phone: string) => ({
  [`kontakte.${name}.first_name`]: first,
  [`kontakte.${name}.last_name`]: "Muster",
  [`kontakte.${name}.email`]: `${first.toLowerCase()}@schule.example.org`,
  [`kontakte.${name}.phone`]: phone,
});

/** The form as the browser posts a picked club's application, each box under its name. */
const BOXES: Readonly<Record<string, string>> = {
  act: "primary",
  saison_id: "2027",
  [IDEMPOTENCY_KEY_FIELD]: KEY,
  [TURNSTILE_FIELD]: TOKEN,
  team_id: TEAM,
  stufengroesse: "90",
  // „Keine weitere Rolle“, the select's empty entry.
  "kontakte.trainer_is_also": "",
  ...seat("trainer", "Tina", "069 90009010"),
  ...seat("ansprechperson", "Anna", "069 90009020"),
  ...seat("stellvertretung", "Stefan", "069 90009030"),
  "trikot.existing_set": "",
  "trikot.wunschfarbe": "rot",
  "kader.expected_size": "16",
  "kader.good_spieler": "3",
  wunschgegner: "",
};

const NEW_SCHOOL: Readonly<Record<string, string>> = {
  "schule.team_name": "Goethe",
  "schule.full_name": "Goethe-Gymnasium",
  "schule.schulform": "gymnasium_g9",
  "schule.website_url": "",
  "schule.address.street": "Friedrich-Ebert-Anlage",
  "schule.address.house_number": "22",
  "schule.address.postcode": "60325",
  "schule.address.city": "Frankfurt am Main",
  "schule.address.district": "Westend",
};

/** What the one write carried, as the backend read it. */
const body = () => backend.sent[0]?.body as Record<string, Record<string, unknown>>;

describe("the application a press sends", () => {
  // The harm: the write refuses a seat differing from the Trainer's as a drifted client, naming no box.
  it("fills a seat the Trainer also holds from the Trainer's own boxes", async () => {
    const { "kontakte.ansprechperson.email": _, ...boxes } = BOXES;
    await submitBewerbung(posted({ ...boxes, "kontakte.trainer_is_also": "ansprechperson" }));

    const { kontakte } = body();
    expect(kontakte?.["ansprechperson"]).toStrictEqual(kontakte?.["trainer"]);
    expect(kontakte?.["trainer_is_also"]).toBe("ansprechperson");
  });

  // The harm: `bewerbung_submission_subject_unresolved`, the unexpected line, for a school that told the form both.
  it("names the new school alone where its boxes stand, whatever the picker still holds", async () => {
    await submitBewerbung(posted({ ...BOXES, ...NEW_SCHOOL }));

    expect(body()["team_id"]).toBeNull();
    expect(body()["schule"]).toMatchObject({ team_name: "Goethe", website_url: null });
  });

  // The harm: a press whose answer was lost, sent again under another key, is a second application and three more mails.
  // The body's own fields are the generated payload's, which tsc holds.
  it("sends the form's replay key", async () => {
    expect(await submitBewerbung(posted(BOXES))).toStrictEqual({ ok: true, value: SUBMITTED });

    expect(backend.sent.map(({ method, path }) => `${method} ${path}`)).toStrictEqual(["POST /bewerbungen"]);
    expect(backend.sent[0]?.headers.get(IDEMPOTENCY_KEY_HEADER)).toBe(KEY);
  });
});

describe("a press the action stops", () => {
  // The harm: the picker left empty reaches the write, whose refusal names no box this form shows: the stale-page line.
  it("holds the picker to a pick while no new school is named", async () => {
    const { team_id: _, ...boxes } = BOXES;
    expect(boxRulesOf(submitBewerbung)["team_id"]?.required).toBe(true);

    expect(await submitBewerbung(posted(boxes))).toStrictEqual({ ok: false, fieldErrors: { team_id: COPY.shared.field.required } });
    expect(backend.sent).toHaveLength(0);
  });

  // The harm: this write mails three addresses its sender names, so a script past the check mails strangers.
  it("writes nothing past a refused bot check", async () => {
    const asked = serveHost(CLOUDFLARE, judging({ success: false, "error-codes": ["invalid-input-response"] }));

    expect(await submitBewerbung(posted(BOXES))).toStrictEqual({ ok: false, reason: COPY.shared.botCheck });
    // Cloudflare judged the token and refused it, and nothing reached the backend.
    expect(asked).toHaveLength(1);
    expect(backend.sent).toHaveLength(0);
  });
});
