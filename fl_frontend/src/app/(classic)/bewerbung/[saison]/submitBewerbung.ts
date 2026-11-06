"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy";
import { bewerbungenPostBewerbung } from "@/core/generated/client/sdk";
import { BewerbungenPostBewerbungBody } from "@/core/generated/zod/inputs";
import { IDEMPOTENCY_KEY_HEADER } from "@/core/idempotencyKey";
import { repeatedContacts } from "@/features/teams/kontaktePersonen";

import { applicationOf, REPLAY_FIELD } from "./application";
import { SUBMITTED } from "./ends";

const { phoneExample } = COPY.admin.schiedsrichter;
const { hausnummerExample, plzExample } = COPY.admin.spielort;

const Application = z.preprocess(applicationOf, BewerbungenPostBewerbungBody.extend({ [REPLAY_FIELD]: z.uuid() }));

/**
 * One school's application, sent by a visitor with no session. Public by necessity, so the bot check answers before
 * anything is read: this write mails three addresses its sender names. It runs as a server action, so the edge meters
 * it by the action pair alone (`nginx/shared/site.conf`), whatever page it is posted at.
 *
 * The replay key is one per form, not per press: only a stored application holds a key, so a press the write refused
 * leaves it free for the next, and a press whose answer was lost finds its application rather than making a second.
 */
export const submitBewerbung = action({
  lane: "public",
  botCheck: true,
  name: "submitBewerbung",
  input: Application,
  ownWords: [
    "bewerbung_picked_team_already_entered",
    "bewerbung_address_barred",
    "bewerbung_key_differing",
    "good_spieler_exceed_kader",
    "email_not_accepted",
    "url_not_accepted",
  ],
  paths: {
    kader: "kader.good_spieler",
    "kontakte.trainer.email": "kontakte.trainer.email",
    "kontakte.ansprechperson.email": "kontakte.ansprechperson.email",
    "kontakte.stellvertretung.email": "kontakte.stellvertretung.email",
    "schule.website_url": "schule.website_url",
  },
  examples: {
    "kontakte.trainer.phone": phoneExample,
    "kontakte.ansprechperson.phone": phoneExample,
    "kontakte.stellvertretung.phone": phoneExample,
    "schule.address.plz": plzExample,
    "schule.address.hausnummer": hausnummerExample,
  },
  run: async ({ [REPLAY_FIELD]: key, ...application }) => {
    // Judged here rather than left to the write, whose refusal names the whole block and so no box.
    const repeated = repeatedContacts(application.kontakte);
    if (repeated.length > 0) return { ok: false, fieldErrors: Object.fromEntries(repeated.map((box) => [box, COPY.shared.field.taken])) };

    await bewerbungenPostBewerbung(application, { headers: { [IDEMPOTENCY_KEY_HEADER]: key } });
    return { ok: true, value: SUBMITTED };
  },
});
