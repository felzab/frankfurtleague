"use server";

import { z } from "zod";

import { action, numberBox } from "@/core/action";
import { COPY } from "@/core/copy";
import { bewerbungenPostKontaktSeat, bewerbungenResendEinwilligung } from "@/core/generated/client/sdk";
import {
  BewerbungenPostKontaktSeatBody,
  BewerbungenPostKontaktSeatParams,
  BewerbungenResendEinwilligungParams,
} from "@/core/generated/zod/inputs";

const { shape } = BewerbungenPostKontaktSeatBody;

/**
 * „Sitz bearbeiten“: writes the person into the seat on the version the page read, whatever its state but an erased one,
 * and owes them a fresh link with that seat's own 14 days, which the dialog says, naming the address the write stored.
 * An address another person of the application holds is refused on its box, one the ban list holds on the status line.
 */
export const writeSeat = action({
  lane: "admin",
  name: "writeSeat",
  input: z.object({
    id: BewerbungenPostKontaktSeatParams.shape.bewerbung_id,
    seat: BewerbungenPostKontaktSeatParams.shape.seat,
    first_name: shape.first_name,
    last_name: shape.last_name,
    email: shape.email,
    phone: shape.phone,
    version: numberBox(shape.version),
  }),
  ownWords: ["bewerbung_kontakt_email_taken", "bewerbung_kontakt_barred", "email_not_accepted"],
  paths: { email: "email" },
  examples: {
    first_name: COPY.shared.field.exampleFirstName,
    last_name: COPY.shared.field.exampleLastName,
    phone: COPY.admin.schiedsrichter.phoneExample,
  },
  run: async ({ id, seat, ...person }) => {
    const { email } = await bewerbungenPostKontaktSeat(id, seat, person);
    return { ok: true, value: undefined, note: COPY.admin.schiedsrichter.sentTo(email) };
  },
});

/**
 * Sends one seat a fresh link, its old one opening nothing, for a mail that went astray or a link that lapsed. An address
 * on the ban list, which the page cannot know, is refused in the list's own sentence.
 */
export const sendSeatLink = action({
  lane: "admin",
  name: "sendSeatLink",
  input: BewerbungenResendEinwilligungParams,
  ownWords: ["bewerbung_kontakt_barred"],
  run: async ({ bewerbung_id: id, seat }) => {
    await bewerbungenResendEinwilligung(id, seat);
    return { ok: true, value: undefined };
  },
});
