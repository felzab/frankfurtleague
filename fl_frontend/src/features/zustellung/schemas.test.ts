import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLBewerbungZustellungEreignisPayloadSchema } from "@/features/bewerbungen/schemas";

import { FLZustellungAbgewiesenPayloadSchema, FLZustellungAngenommenPayloadSchema, FLZustellungEreignisPayloadSchema } from "./schemas";

const ZIEL_ID = `${"c".repeat(23)}3`;
const BEWERBUNG_ID = `${"a".repeat(23)}1`;
const MESSAGE_ID = "56761188-7520-42d8-8898-ff6fc54ce618";
const EVENT_AT = "2026-09-08T10:15:00.000Z";

/** Every mirror of one backend field, so a screen added to one alone fails here rather than at a 422 nobody sees. */
const MIRRORS = [
  [
    "features/zustellung/schemas.ts :: FLZustellungEreignisPayloadSchema",
    FLZustellungEreignisPayloadSchema,
    { ziel: "schiedsrichter", ziel_id: ZIEL_ID, rollen: [], nachricht_id: MESSAGE_ID, stand: "unzustellbar", am: EVENT_AT },
  ],
  [
    "features/zustellung/schemas.ts :: FLZustellungEreignisPayloadSchema, a season row's seat",
    FLZustellungEreignisPayloadSchema,
    { ziel: "kontakt", ziel_id: ZIEL_ID, rollen: ["trainer"], nachricht_id: MESSAGE_ID, stand: "unzustellbar", am: EVENT_AT },
  ],
  [
    "features/bewerbungen/schemas.ts :: FLBewerbungZustellungEreignisPayloadSchema",
    FLBewerbungZustellungEreignisPayloadSchema,
    { bewerbung_id: BEWERBUNG_ID, rollen: ["ansprechperson"], nachricht_id: MESSAGE_ID, stand: "unzustellbar", am: EVENT_AT },
  ],
  [
    "features/zustellung/schemas.ts :: FLZustellungAbgewiesenPayloadSchema",
    FLZustellungAbgewiesenPayloadSchema,
    { ziel: "schiedsrichter", ziel_id: ZIEL_ID, rollen: [], am: EVENT_AT },
  ],
] as const;

const bodyFor = (keys: Record<string, unknown>, grund: string | null) => ({ ...keys, grund: grund });

describe("the provider's own token, as both mirrors screen it", () => {
  for (const [name, schema, keys] of MIRRORS) {
    /* `fl_backend/app/shared/schemas/custom.py :: SINGLE_LINE_PATTERN` screens the field at the
       endpoint, and a mirror without it composes a body the endpoint answers 422 — which
       `fl_frontend/src/app/api/mail/zustellung/route.ts` turns into a 200, so the bounce is lost. */
    it(`${name} refuses a break forging a header line`, () => {
      const forged = schema.safeParse(bodyFor(keys, "MailboxFull\nBcc: someone@example.com"));

      assert.equal(forged.success, false);
      assert.deepEqual(
        forged.error?.issues.map((issue) => issue.path.join(".")),
        ["grund"],
      );
    });

    it(`${name} takes the provider's own token, and a null`, () => {
      assert.equal(schema.safeParse(bodyFor(keys, "NoEmail")).success, true);
      assert.equal(schema.safeParse(bodyFor(keys, null)).success, true);
    });

    /* The endpoint takes an empty reason: a bounce carrying no token is still a fact about the
       mailbox, and a floor here would drop the whole state with the missing word. */
    it(`${name} takes an empty token`, () => {
      assert.equal(schema.safeParse(bodyFor(keys, "")).success, true);
    });
  }
});

describe("the seats a delivery write names", () => {
  const WRITES = [
    ["angenommen", FLZustellungAngenommenPayloadSchema, { nachricht_id: MESSAGE_ID }],
    ["abgewiesen", FLZustellungAbgewiesenPayloadSchema, { grund: null }],
    ["ereignis", FLZustellungEreignisPayloadSchema, { nachricht_id: MESSAGE_ID, stand: "zugestellt", grund: null }],
  ] as const;

  /* The endpoint pairs the kind with its seats and answers 422 otherwise, which the delivery route
     turns into a 200: a body it refuses is a record lost with nothing to say so. */
  for (const [name, schema, rest] of WRITES) {
    it(`${name} takes a season row's seats and refuses a season row naming none`, () => {
      const body = (rollen: string[]) => ({ ziel: "kontakt", ziel_id: ZIEL_ID, rollen: rollen, am: EVENT_AT, ...rest });

      assert.equal(schema.safeParse(body(["ansprechperson", "trainer"])).success, true);
      assert.deepEqual(
        schema.safeParse(body([])).error?.issues.map((issue) => issue.path.join(".")),
        ["rollen"],
      );
    });

    it(`${name} refuses a seat on a kind with one carrier, and a body naming no seats at all`, () => {
      const body = { ziel: "schiedsrichter", ziel_id: ZIEL_ID, am: EVENT_AT, ...rest };

      assert.equal(schema.safeParse({ ...body, rollen: [] }).success, true);
      assert.deepEqual(
        schema.safeParse({ ...body, rollen: ["trainer"] }).error?.issues.map((issue) => issue.path.join(".")),
        ["rollen"],
      );
      assert.equal(schema.safeParse(body).success, false, "the required key was left out and the body still parsed");
    });
  }
});
