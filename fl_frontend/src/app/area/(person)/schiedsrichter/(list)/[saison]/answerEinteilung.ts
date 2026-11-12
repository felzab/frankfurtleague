"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { spielbestaetigungenPostSchiedsrichterAnswer } from "@/core/generated/client/sdk";
import {
  SpielbestaetigungenPostSchiedsrichterAnswerBody,
  SpielbestaetigungenPostSchiedsrichterAnswerParams,
} from "@/core/generated/zod/inputs";

const ID = SpielbestaetigungenPostSchiedsrichterAnswerParams.shape.spielbestaetigung_id;

/**
 * The referee's „Zusagen“ on a game's row of their Übersicht, done at once: the first answer binds. The backend
 * judges the row as the referee's own in its transaction; a row answered, closed or moved since the page was read is
 * refused as the stale page it is.
 */
export const agreeEinteilung = action({
  lane: "person",
  claim: "record",
  name: "agreeEinteilung",
  input: z.object({ id: ID }),
  run: async ({ id }) => {
    await spielbestaetigungenPostSchiedsrichterAnswer(id, { answer: "agreed", reason: null });
    return { ok: true, value: undefined };
  },
});

/** The referee's „Ablehnen“ from its dialog, with the reason the administrator reads. */
export const declineEinteilung = action({
  lane: "person",
  claim: "record",
  name: "declineEinteilung",
  // A reason of spaces alone passes the box and meets the backend's rule, which words it on the reason's box.
  ownWords: ["decline_without_reason"],
  input: z.object({ id: ID, reason: SpielbestaetigungenPostSchiedsrichterAnswerBody.shape.reason }),
  run: async ({ id, reason }) => {
    await spielbestaetigungenPostSchiedsrichterAnswer(id, { answer: "declined", reason });
    return { ok: true, value: undefined };
  },
});
