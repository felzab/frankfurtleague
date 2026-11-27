import "server-only";

import { requires } from "@/core/action";
import {
  BewerbungenAcceptBewerbungBody,
  BewerbungenDeclineBewerbungBody,
  bewerbungenDeclineBewerbungBodyReasonMax,
  BewerbungenPostKontaktSeatBody,
  bewerbungenPostKontaktSeatBodyEmailMax,
  bewerbungenPostKontaktSeatBodyFirstNameMax,
  bewerbungenPostKontaktSeatBodyFirstNameRegExp,
  bewerbungenPostKontaktSeatBodyLastNameMax,
  bewerbungenPostKontaktSeatBodyLastNameRegExp,
  bewerbungenPostKontaktSeatBodyPhoneRegExp,
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
  // Each a source, the one form of a pattern a server page can hand a client field (`kit/TextField.tsx :: judgeOf`).
  pattern: {
    first_name: bewerbungenPostKontaktSeatBodyFirstNameRegExp.source,
    last_name: bewerbungenPostKontaktSeatBodyLastNameRegExp.source,
    phone: bewerbungenPostKontaktSeatBodyPhoneRegExp.source,
  },
} as const;

export type AcceptRules = typeof ACCEPT_RULES;
