"use server";

import { z } from "zod";

import { action, blankIsNull, numberBox } from "@/core/action";
import { COPY } from "@/core/copy";
import { bewerbungenAcceptBewerbung, bewerbungenDeclineBewerbung } from "@/core/generated/client/sdk";
import {
  BewerbungenAcceptBewerbungBody,
  BewerbungenAcceptBewerbungParams,
  BewerbungenDeclineBewerbungBody,
  BewerbungenDeclineBewerbungParams,
} from "@/core/generated/zod/inputs";

const accepted = BewerbungenAcceptBewerbungBody.shape;
const declined = BewerbungenDeclineBewerbungBody.shape;

/**
 * Accepts the application on the version its page read: enters the club into the season, creating it for a new school,
 * and owes every person the acceptance, in one write. A code another club holds is refused on its box; a club the
 * season already holds or the league retired on the status line; anything else that moved since as the stale page it is.
 * The dialog sends one, and the Sammel-Zusage one per card.
 */
export const acceptBewerbung = action({
  lane: "admin",
  name: "acceptBewerbung",
  input: z.object({
    id: BewerbungenAcceptBewerbungParams.shape.bewerbung_id,
    gruppe: accepted.gruppe,
    trikot_farbe: blankIsNull(accepted.trikot_farbe),
    // A known club's closed box posts nothing, and an open one left empty the same: no code to set.
    shorthand: z.preprocess((value) => value ?? "", blankIsNull(accepted.shorthand)),
    version: numberBox(accepted.version),
  }),
  ownWords: ["duplicate_key", "bewerbung_picked_team_already_entered", "team_retired"],
  paths: { shorthand: "shorthand" },
  examples: { shorthand: COPY.team.shorthandExample },
  run: async ({ id, ...body }) => {
    await bewerbungenAcceptBewerbung(id, body);
    return { ok: true, value: undefined };
  },
});

/** Declines the application on the version its page read, and owes every person the reason as it was typed. */
export const declineBewerbung = action({
  lane: "admin",
  name: "declineBewerbung",
  input: z.object({
    id: BewerbungenDeclineBewerbungParams.shape.bewerbung_id,
    reason: declined.reason,
    version: numberBox(declined.version),
  }),
  run: async ({ id, ...body }) => {
    await bewerbungenDeclineBewerbung(id, body);
    return { ok: true, value: undefined };
  },
});
