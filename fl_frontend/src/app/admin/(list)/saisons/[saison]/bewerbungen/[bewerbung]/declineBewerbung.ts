"use server";

import { z } from "zod";

import { action, numberBox } from "@/core/action";
import { bewerbungenDeclineBewerbung } from "@/core/generated/client/sdk";
import { BewerbungenDeclineBewerbungBody, BewerbungenDeclineBewerbungParams } from "@/core/generated/zod/inputs";

const declined = BewerbungenDeclineBewerbungBody.shape;

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
