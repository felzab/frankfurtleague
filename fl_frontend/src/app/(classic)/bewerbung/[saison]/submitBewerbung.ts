"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy/shared";
import { bewerbungenPostBewerbung } from "@/core/generated/client/sdk";
import { BewerbungenPostBewerbungBody } from "@/core/generated/zod/inputs";
import { IDEMPOTENCY_KEY_FIELD, IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";
import { KONTAKT_SEATS } from "@/features/teams/constants";

import { applicationOf } from "./application";
import { SUBMITTED } from "./ends";

import type { Copy } from "@/core/copy";
import type { FLBewerbungKontaktpersonPayload } from "@/core/generated/client/types";

const { exampleFirstName, exampleLastName, examplePhone } = COPY.shared.field;
const { houseNumberExample, postcodeExample } = COPY.shared.address;

/** Every seat's box for `field`, by its dotted name. */
const eachSeat = <Field extends keyof FLBewerbungKontaktpersonPayload>(field: Field) =>
  KONTAKT_SEATS.map((seat) => `kontakte.${seat}.${field}` as const);

/** The same example for every seat's box for `field`. */
const exampleOfEachSeat = (field: keyof FLBewerbungKontaktpersonPayload, example: Copy) =>
  Object.fromEntries(eachSeat(field).map((box) => [box, example]));

const Application = z.preprocess(
  applicationOf,
  BewerbungenPostBewerbungBody.extend({
    // A club picked, or none sent beside a new school: judged as absent rather than empty, so its box is required
    // wherever the picker posts, which it does only while it is the answer.
    team_id: BewerbungenPostBewerbungBody.shape.team_id.options[0].optional().transform((id) => id ?? null),
    [IDEMPOTENCY_KEY_FIELD]: z.uuid(),
  }),
);

/**
 * One school's application, sent by a visitor with no session. Public by necessity, so the bot check answers before
 * anything is read: this write mails three addresses its sender names. It runs as a server action, so the edge meters
 * it as it meters every server action, whatever page it is posted at.
 *
 * The replay key is the form's, one for each version of what it posts: a press whose answer was lost, sent again
 * unchanged, finds its application rather than making a second.
 */
export const submitBewerbung = action({
  lane: "public",
  botCheck: true,
  name: "submitBewerbung",
  input: Application,
  boxes: [...eachSeat("email"), ...eachSeat("phone"), "schule.website_url"],
  // The squad's rule refuses its group as a whole, and its phrase stands under the count it bounds.
  paths: { kader: "kader.good_spieler" },
  examples: {
    ...exampleOfEachSeat("first_name", exampleFirstName),
    ...exampleOfEachSeat("last_name", exampleLastName),
    ...exampleOfEachSeat("phone", examplePhone),
    "schule.address.postcode": postcodeExample,
    "schule.address.house_number": houseNumberExample,
  },
  run: async ({ [IDEMPOTENCY_KEY_FIELD]: key, ...application }) => {
    await bewerbungenPostBewerbung(application, { headers: { [IDEMPOTENCY_KEY_HEADER]: key } });
    return { ok: true, value: SUBMITTED };
  },
});
