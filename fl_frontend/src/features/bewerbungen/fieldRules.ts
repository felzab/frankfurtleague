import "server-only";

import { requires } from "@/core/action";
import {
  BewerbungenAcceptBewerbungBody,
  BewerbungenDeclineBewerbungBody,
  bewerbungenDeclineBewerbungBodyReasonMax,
  BewerbungenPostKontaktSeatBody,
  bewerbungenPostKontaktSeatBodyEmailMax,
  bewerbungenPostKontaktSeatBodyFirstNameMax,
  bewerbungenPostKontaktSeatBodyLastNameMax,
} from "@/core/generated/zod/inputs";

const seat = BewerbungenPostKontaktSeatBody.shape;

/** The Kürzel is the stored application's to require, a new school's alone. */
export const ACCEPT_RULES = {
  required: {
    gruppe: requires(BewerbungenAcceptBewerbungBody.shape.gruppe, ""),
    trikot_farbe: requires(BewerbungenAcceptBewerbungBody.shape.trikot_farbe, null),
  },
} as const;

export const DECLINE_RULES = {
  required: requires(BewerbungenDeclineBewerbungBody.shape.reason, ""),
  max: bewerbungenDeclineBewerbungBodyReasonMax,
} as const;

/** Read on the server so its schema never reaches the browser. */
export const SEAT_RULES = {
  required: {
    first_name: requires(seat.first_name, ""),
    last_name: requires(seat.last_name, ""),
    email: requires(seat.email, ""),
    phone: requires(seat.phone, ""),
  },
  max: {
    first_name: bewerbungenPostKontaktSeatBodyFirstNameMax,
    last_name: bewerbungenPostKontaktSeatBodyLastNameMax,
    email: bewerbungenPostKontaktSeatBodyEmailMax,
  },
} as const;

export type AcceptRules = typeof ACCEPT_RULES;
