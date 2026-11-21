"use server";

import { z } from "zod";

import { action, numberBox, PAGE_HOLDER } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import { bewerbungenPostKontaktSeat, bewerbungenResendKontaktConfirmation } from "@/core/generated/client/sdk";
import {
  BewerbungenPostKontaktSeatBody,
  BewerbungenPostKontaktSeatParams,
  BewerbungenResendKontaktConfirmationParams,
} from "@/core/generated/zod/inputs";
import { SERVER_COPY } from "@/core/serverCopy";

const { shape } = BewerbungenPostKontaktSeatBody;

const CLOSED = SERVER_COPY.closedDialog;

/**
 * „Sitz bearbeiten“, behind the passkey touch: writes the person into the seat on the version the page read, whatever
 * its state but an erased one, and owes them a fresh link with that seat's own 14 days, the toast naming the address the
 * write stored. The dialog has closed before any answer, so every refusal is a sentence (`boxless`): an address or a
 * number another person of the application holds names its box, and a finished season's application, which takes no
 * write, says so.
 */
export const writeBewerbungSeat = action({
  lane: "admin",
  passkey: true,
  name: "writeBewerbungSeat",
  input: z.object({
    id: BewerbungenPostKontaktSeatParams.shape.bewerbung_id,
    seat: BewerbungenPostKontaktSeatParams.shape.seat,
    first_name: shape.first_name,
    last_name: shape.last_name,
    email: shape.email,
    phone: shape.phone,
    version: numberBox(shape.version),
    ...PAGE_HOLDER,
  }),
  boxless: {
    first_name: { required: CLOSED.firstNameMissing, value: CLOSED.format.firstName },
    last_name: { required: CLOSED.lastNameMissing, value: CLOSED.format.lastName },
    email: { value: CLOSED.format.address, email_not_accepted: CLOSED.format.address, kontakt_email_taken: CLOSED.taken.address },
    phone: { value: CLOSED.format.phone, kontakt_phone_taken: CLOSED.taken.phone },
  },
  // The holder is the touch's to judge, and no field of the seat's body.
  run: async ({ id, seat, holder: _holder, ...person }) => {
    const { email } = await bewerbungenPostKontaktSeat(id, seat, person);
    return { ok: true, value: undefined, note: ADMIN_COPY.schiedsrichter.sentTo(email) };
  },
});

/**
 * Sends one seat a fresh link, its old one opening nothing, for a mail that went astray or a link that lapsed. A
 * finished season's application takes none, which the status line says.
 */
export const sendBewerbungSeatLink = action({
  lane: "admin",
  name: "sendBewerbungSeatLink",
  input: BewerbungenResendKontaktConfirmationParams,
  run: async ({ bewerbung_id: id, seat }) => {
    await bewerbungenResendKontaktConfirmation(id, seat);
    return { ok: true, value: undefined };
  },
});
