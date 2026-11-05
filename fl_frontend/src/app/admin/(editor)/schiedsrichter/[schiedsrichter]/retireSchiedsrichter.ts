"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { COPY } from "@/core/copy";
import {
  schiedsrichterDeleteSchiedsrichter,
  schiedsrichterInviteSchiedsrichter,
  schiedsrichterReactivateSchiedsrichter,
} from "@/core/generated/client/sdk";
import {
  SchiedsrichterDeleteSchiedsrichterParams,
  SchiedsrichterInviteSchiedsrichterParams,
  SchiedsrichterReactivateSchiedsrichterParams,
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
  ownWords: ["schiedsrichter_still_assigned"],
  run: async ({ id }) => {
    await schiedsrichterDeleteSchiedsrichter(id);
    return { ok: true, value: undefined };
  },
});

/**
 * Brings a retired referee back into every match's choice. One who has not answered is asked again, a fresh link
 * mailed, which an address on the ban list refuses, the referee staying retired.
 */
export const reactivateSchiedsrichter = action({
  lane: "admin",
  name: "reactivateSchiedsrichter",
  input: z.object({ id: SchiedsrichterReactivateSchiedsrichterParams.shape.schiedsrichter_id }),
  ownWords: ["schiedsrichter_address_barred"],
  run: async ({ id }) => {
    await schiedsrichterReactivateSchiedsrichter(id);
    return { ok: true, value: undefined };
  },
});

/**
 * Mails a referee who has not answered a fresh link, the deadline starting again and the old link void, its line
 * naming the address the backend read it to. The editor offers it only while their entry waits on an answer, so a
 * retirement, an answer or an address gone since is a stale page; an address on the ban list, which the page cannot
 * know, is refused in the list's own sentence.
 */
export const sendSchiedsrichterLink = action({
  lane: "admin",
  name: "sendSchiedsrichterLink",
  input: z.object({ id: SchiedsrichterInviteSchiedsrichterParams.shape.schiedsrichter_id }),
  ownWords: ["schiedsrichter_address_barred"],
  run: async ({ id }) => {
    const { confirmation } = await schiedsrichterInviteSchiedsrichter(id);
    return { ok: true, value: undefined, note: COPY.admin.schiedsrichter.sentTo(confirmation.email) };
  },
});
