"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { ActionLogGetActionLogBody } from "@/core/generated/zod/inputs";

import { logParams, PERIOD_CHOICES, TYPE_CHOICES } from "./filters";
import { getActionLog } from "./queries";
import { rowOf } from "./rows";

const { by, cursor, q } = ActionLogGetActionLogBody.shape;

export const loadActionLog = action({
  lane: "admin",
  name: "loadActionLog",
  input: z.object({ query: q, cursor, by, type: z.enum(TYPE_CHOICES).nullish(), time: z.enum(PERIOD_CHOICES).nullish() }),
  run: async ({ query, cursor: after, ...filters }) => {
    const page = await getActionLog({ ...logParams(filters), q: query, cursor: after });
    return { ok: true, value: { rows: page.action_log.map(rowOf), cursor: page.cursor } };
  },
});
