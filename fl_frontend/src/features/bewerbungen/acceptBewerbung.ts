"use server";

import { z } from "zod";

import { action, blankIsNull, numberBox } from "@/core/action";
import { COPY } from "@/core/copy/shared";
import { bewerbungenAcceptBewerbung } from "@/core/generated/client/sdk";
import { BewerbungenAcceptBewerbungBody, BewerbungenAcceptBewerbungParams } from "@/core/generated/zod/inputs";

const accepted = BewerbungenAcceptBewerbungBody.shape;

/**
 * Accepts the application on the version its page read: enters the club into the season, creating it for a new school,
 * and owes every person the acceptance, in one write. A code another club holds and a colour another row of the season
 * holds are refused on their boxes; a club the season already holds or the league retired on the status line; anything
 * else that moved since as the stale page it is.
 */
export const acceptBewerbung = action({
  lane: "admin",
  name: "acceptBewerbung",
  input: z.object({
    id: BewerbungenAcceptBewerbungParams.shape.bewerbung_id,
    gruppe: accepted.gruppe,
    trikot_farbe: blankIsNull(accepted.trikot_farbe),
    // A known club's closed box posts nothing, no code to set; an open one, a new school's, is judged as a code, so its
    // derived rule requires it.
    shorthand: accepted.shorthand.options[0].optional().transform((code) => code ?? null),
    version: numberBox(accepted.version),
  }),
  boxes: ["shorthand", "trikot_farbe"],
  examples: { shorthand: COPY.team.shorthandExample },
  run: async ({ id, ...body }) => {
    await bewerbungenAcceptBewerbung(id, body);
    return { ok: true, value: undefined };
  },
});
