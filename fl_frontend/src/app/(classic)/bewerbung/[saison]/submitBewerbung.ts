"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy";
import { bewerbungenPostBewerbung } from "@/core/generated/client/sdk";
import { BewerbungenPostBewerbungBody } from "@/core/generated/zod/inputs";
import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";

import { applicationOf, REPLAY_FIELD } from "./application";
import { SUBMITTED } from "./ends";

const { exampleFirstName, exampleLastName } = COPY.shared.field;
const { phoneExample } = COPY.admin.schiedsrichter;
const { houseNumberExample, postcodeExample } = COPY.admin.spielort;

const Application = z.preprocess(applicationOf, BewerbungenPostBewerbungBody.extend({ [REPLAY_FIELD]: z.uuid() }));

/**
 * One school's application, sent by a visitor with no session. Public by necessity, so the bot check answers before
 * anything is read: this write mails three addresses its sender names. It runs as a server action, so the edge meters
 * it by the action pair alone (`nginx/shared/site.conf`), whatever page it is posted at.
 *
 * The replay key is the form's, one for each version of what it posts (`fl_frontend/src/kit/OneShot.tsx :: replayField`):
 * a press whose answer was lost, sent again unchanged, finds its application rather than making a second.
 */
export const submitBewerbung = action({
  lane: "public",
  botCheck: true,
  name: "submitBewerbung",
  input: Application,
  ownWords: [
    "bewerbung_picked_team_already_entered",
    "bewerbung_kontakt_repeated",
    "good_spieler_exceed_kader",
    "email_not_accepted",
    "url_not_accepted",
  ],
  paths: {
    kader: "kader.good_spieler",
    "kontakte.trainer.email": "kontakte.trainer.email",
    "kontakte.trainer.phone": "kontakte.trainer.phone",
    "kontakte.ansprechperson.email": "kontakte.ansprechperson.email",
    "kontakte.ansprechperson.phone": "kontakte.ansprechperson.phone",
    "kontakte.stellvertretung.email": "kontakte.stellvertretung.email",
    "kontakte.stellvertretung.phone": "kontakte.stellvertretung.phone",
    "schule.website_url": "schule.website_url",
  },
  examples: {
    "kontakte.trainer.first_name": exampleFirstName,
    "kontakte.trainer.last_name": exampleLastName,
    "kontakte.trainer.phone": phoneExample,
    "kontakte.ansprechperson.first_name": exampleFirstName,
    "kontakte.ansprechperson.last_name": exampleLastName,
    "kontakte.ansprechperson.phone": phoneExample,
    "kontakte.stellvertretung.first_name": exampleFirstName,
    "kontakte.stellvertretung.last_name": exampleLastName,
    "kontakte.stellvertretung.phone": phoneExample,
    "schule.address.postcode": postcodeExample,
    "schule.address.house_number": houseNumberExample,
  },
  run: async ({ [REPLAY_FIELD]: key, ...application }) => {
    await bewerbungenPostBewerbung(application, { headers: { [IDEMPOTENCY_KEY_HEADER]: key } });
    return { ok: true, value: SUBMITTED };
  },
});
