"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import {
  schiedsrichterDeleteSchiedsrichter,
  schiedsrichterReactivateSchiedsrichter,
  schiedsrichterResendConfirmation,
} from "@/core/generated/client/sdk";
import {
  SchiedsrichterDeleteSchiedsrichterParams,
  SchiedsrichterReactivateSchiedsrichterParams,
  SchiedsrichterResendConfirmationParams,
} from "@/core/generated/zod/inputs";

/**
 * Retires the referee from their editor's danger box: they stay on the matches already played, and no new match
 * books them. A referee still booked for a match to come is refused, the sentence naming those matches by their
 * numbers from the refusal's bounds, so the confirmation stays open saying which to rebook first.
 */
export const retireSchiedsrichter = action({
  lane: "admin",
  name: "retireSchiedsrichter",
  input: z.object({ id: SchiedsrichterDeleteSchiedsrichterParams.shape.schiedsrichter_id }),
  run: async ({ id }) => {
    await schiedsrichterDeleteSchiedsrichter(id);
    return { ok: true, value: undefined };
  },
});

/**
 * Brings a retired referee back into every match's choice. One who has not answered is asked again, a fresh link
 * mailed, which the answer says, naming the address it went to.
 */
export const reactivateSchiedsrichter = action({
  lane: "admin",
  name: "reactivateSchiedsrichter",
  input: z.object({ id: SchiedsrichterReactivateSchiedsrichterParams.shape.schiedsrichter_id }),
  run: async ({ id }) => {
    const { confirmation } = await schiedsrichterReactivateSchiedsrichter(id);
    return confirmation === null
      ? { ok: true, value: undefined }
      : { ok: true, value: undefined, note: ADMIN_COPY.schiedsrichter.sentTo(confirmation.email) };
  },
});

/**
 * Mails a referee who has not answered a fresh link, the deadline starting again and the old link void, answered as
 * every resent link is, since the address stands on the editor already. The editor offers it only while their entry
 * waits on an answer, so a retirement, an answer or an address gone since is a stale page.
 */
export const sendSchiedsrichterLink = action({
  lane: "admin",
  name: "sendSchiedsrichterLink",
  input: z.object({ id: SchiedsrichterResendConfirmationParams.shape.schiedsrichter_id }),
  run: async ({ id }) => {
    await schiedsrichterResendConfirmation(id);
    return { ok: true, value: undefined };
  },
});
