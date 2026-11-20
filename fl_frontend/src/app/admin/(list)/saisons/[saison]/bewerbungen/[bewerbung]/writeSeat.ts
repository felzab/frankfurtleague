"use server";

import { z } from "zod";

import { action, numberBox } from "@/core/action";
import { COPY } from "@/core/copy";
import { bewerbungenPostKontaktSeat, bewerbungenResendKontaktConfirmation } from "@/core/generated/client/sdk";
import {
  BewerbungenPostKontaktSeatBody,
  BewerbungenPostKontaktSeatParams,
  BewerbungenResendKontaktConfirmationParams,
} from "@/core/generated/zod/inputs";

const { shape } = BewerbungenPostKontaktSeatBody;

/**
 * „Sitz bearbeiten“: writes the person into the seat on the version the page read, whatever its state but an erased one,
 * and owes them a fresh link with that seat's own 14 days, which the dialog says, naming the address the write stored.
 * An address or a number another person of the application holds is refused on its box, an address the ban list holds
 * on the status line, and so is a finished season's application, which takes no write.
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
  ownWords: ["kontakt_email_taken", "kontakt_phone_taken", "email_not_accepted", "saison_past"],
  paths: { email: "email", phone: "phone" },
  examples: {
    first_name: COPY.shared.field.exampleFirstName,
    last_name: COPY.shared.field.exampleLastName,
    phone: COPY.shared.field.examplePhone,
  },
  run: async ({ id, seat, ...person }) => {
    const { email } = await bewerbungenPostKontaktSeat(id, seat, person);
    return { ok: true, value: undefined, note: COPY.admin.schiedsrichter.sentTo(email) };
  },
});

/**
 * Sends one seat a fresh link, its old one opening nothing, for a mail that went astray or a link that lapsed. A
 * finished season's application takes none, which the status line says.
 */
export const sendSeatLink = action({
  lane: "admin",
  name: "sendSeatLink",
  input: BewerbungenResendKontaktConfirmationParams,
  ownWords: ["saison_past"],
  run: async ({ bewerbung_id: id, seat }) => {
    await bewerbungenResendKontaktConfirmation(id, seat);
    return { ok: true, value: undefined };
  },
});
