import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";
import { TURNSTILE_FIELD } from "@/core/turnstileToken";

import { NO_SECOND_SEAT, REPLAY_FIELD } from "./application";
import { SUBMITTED } from "./ends";

const check = vi.hoisted(() => ({ refusal: null as string | null }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
// Next's `updateTag` throws outside a Server Action; whether a write clears the site's cache is `core/action.test.ts`'s.
vi.mock("next/cache", () => ({ updateTag: () => undefined }));
// Cloudflare's own verdict, which `core/turnstile.test.ts` judges.
vi.mock("@/core/turnstile", () => ({ turnstileRefusal: async () => check.refusal }));

const { calls } = doubleApiAnswers(() => Promise.resolve({ created_id: "6890a1b2c3d4e5f607190001" }));

const { submitBewerbung } = await import("./submitBewerbung");

const KEY = "3f2b8c1e-7a4d-4e6f-9b1a-2c3d4e5f6a7b";
const CLUB = "6890a1b2c3d4e5f607190002";

const seat = (name: string, first: string, phone: string) => ({
  [`kontakte.${name}.first_name`]: first,
  [`kontakte.${name}.last_name`]: "Muster",
  [`kontakte.${name}.email`]: `${first.toLowerCase()}@schule.de`,
  [`kontakte.${name}.phone`]: phone,
});

/** The form as the browser posts a picked club's application, each box under its name. */
const BOXES: Readonly<Record<string, string>> = {
  act: "primary",
  saison_id: "2027",
  [REPLAY_FIELD]: KEY,
  [TURNSTILE_FIELD]: "token",
  team_id: CLUB,
  stufengroesse: "90",
  "kontakte.trainer_is_also": NO_SECOND_SEAT,
  ...seat("trainer", "Tina", "069 1000"),
  ...seat("ansprechperson", "Anna", "069 2000"),
  ...seat("stellvertretung", "Stefan", "069 3000"),
  "trikot.existing_satz": "",
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
  "schule.address.strasse": "Friedrich-Ebert-Anlage",
  "schule.address.hausnummer": "22",
  "schule.address.plz": "60325",
  "schule.address.stadt": "Frankfurt am Main",
  "schule.address.stadtteil": "Westend",
};

const posted = (entries: Readonly<Record<string, string>>) => {
  const formData = new FormData();
  for (const [name, value] of Object.entries(entries)) formData.set(name, value);
  return formData;
};

/** What the one write carried, parsed. */
const body = () => requestsOf(calls)[0]?.body as Record<string, Record<string, unknown>>;

beforeEach(() => {
  check.refusal = null;
});

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
  it("sends the form's replay key, and the backend no field of its own", async () => {
    expect(await submitBewerbung(posted(BOXES))).toStrictEqual({ ok: true, value: SUBMITTED });

    expect(calls[0]?.headers.get(IDEMPOTENCY_KEY_HEADER)).toBe(KEY);
    expect(Object.keys(body())).toStrictEqual([
      "kader",
      "kontakte",
      "saison_id",
      "schule",
      "stufengroesse",
      "team_id",
      "trikot",
      "wunschgegner",
    ]);
  });
});

describe("a press the action stops", () => {
  // The harm: this write mails three addresses its sender names, so a script past the check mails strangers.
  it("writes nothing past a refused bot check", async () => {
    check.refusal = COPY.shared.botCheck;

    expect(await submitBewerbung(posted(BOXES))).toStrictEqual({ ok: false, reason: COPY.shared.botCheck });
    expect(calls).toHaveLength(0);
  });

  // The harm: the write's refusal names the block, so the applicant is told only that something went wrong.
  it("marks the second of two seats sharing an address or a number, on its box", async () => {
    const answer = await submitBewerbung(
      posted({ ...BOXES, "kontakte.stellvertretung.email": "ANNA@schule.de", "kontakte.stellvertretung.phone": "+49 (0)69 2000" }),
    );

    expect(answer).toStrictEqual({
      ok: false,
      fieldErrors: { "kontakte.stellvertretung.email": COPY.shared.field.taken, "kontakte.stellvertretung.phone": COPY.shared.field.taken },
    });
    expect(calls).toHaveLength(0);
  });
});
