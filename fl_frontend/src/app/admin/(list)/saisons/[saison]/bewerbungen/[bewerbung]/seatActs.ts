"use server";

import { z } from "zod";

import { action, numberBox, PAGE_HOLDER } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { bewerbungenPostKontaktSeat, bewerbungenResendKontaktConfirmation } from "@/core/generated/client/sdk";
import {
  BewerbungenPostKontaktSeatBody,
  BewerbungenPostKontaktSeatParams,
  BewerbungenResendKontaktConfirmationParams,
} from "@/core/generated/zod/inputs";

const { shape } = BewerbungenPostKontaktSeatBody;

/**
 * „Sitz bearbeiten“, behind its dry run and the passkey touch: writes the person into the seat on the version the page
 * read, whatever its state but an erased one, and owes them a fresh link with that seat's own 14 days, the toast naming
 * the address the write stored. An address or a number another person of the application holds is refused on its box,
 * and a finished season's application, which takes no write, on the line, each by the dry run before the touch.
 */
export const writeBewerbungSeat = action({
  lane: "admin",
  passkey: true,
  dryRun: true,
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
  boxes: ["first_name", "last_name", "email", "phone"],
  examples: {
    first_name: COPY.shared.field.exampleFirstName,
    last_name: COPY.shared.field.exampleLastName,
    email: COPY.shared.field.exampleAddress,
    phone: COPY.shared.field.examplePhone,
  },
  // The holder is the touch's to judge, and no field of the seat's body.
  run: async ({ id, seat, holder: _holder, ...person }, { dryRun }) => {
    const written = await bewerbungenPostKontaktSeat(id, seat, person, { dry_run: dryRun });
    // A passing dry run answers 204, which the client reads as no body: nothing was written to name.
    if (!written) return { ok: true, value: undefined };
    return { ok: true, value: undefined, note: ADMIN_COPY.schiedsrichter.sentTo(written.email) };
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
