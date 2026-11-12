"use server";

import { z } from "zod";

import { action, blankIsNull } from "@/core/action";
import { spielbestaetigungenPostTeamAnswer } from "@/core/generated/client/sdk";
import { SpielbestaetigungenPostTeamAnswerBody, SpielbestaetigungenPostTeamAnswerParams } from "@/core/generated/zod/inputs";

const answer = SpielbestaetigungenPostTeamAnswerBody.shape;
const vorschlag = answer.vorschlag.options[0].shape;
const ROW = SpielbestaetigungenPostTeamAnswerParams.shape.spielbestaetigung_id;

/**
 * The team's Zusage to a date the league asked it about, from the Übersicht's row at once. The backend judges the
 * signed-in person's seat on the row's team and the row itself in its transaction, so a row of another team, or one
 * answered, closed or moved since the page was read, is refused there.
 */
export const agreeSpielbestaetigung = action({
  lane: "person",
  claim: "record",
  name: "agreeSpielbestaetigung",
  input: z.object({ id: ROW }),
  run: async ({ id }) => {
    await spielbestaetigungenPostTeamAnswer(id, { answer: "agreed", reason: null, vorschlag: null });
    return { ok: true, value: undefined };
  },
});

/**
 * The team's decline of a date, proposing another day and hour and, where the person gives one, a reason. A proposal
 * the administrator's own save of that date would refuse is refused here in that save's words.
 */
export const declineSpielbestaetigung = action({
  lane: "person",
  claim: "record",
  name: "declineSpielbestaetigung",
  input: z.object({ id: ROW, date: vorschlag.date, time: vorschlag.time, reason: blankIsNull(answer.reason) }),
  ownWords: ["ansetzung_vorschlag_unchanged", "spiel_outside_spieltag", "spiel_double_booked", "eligibility_disqualified"],
  run: async ({ id, date, time, reason }) => {
    await spielbestaetigungenPostTeamAnswer(id, { answer: "declined", reason, vorschlag: { date, time } });
    return { ok: true, value: undefined };
  },
});
