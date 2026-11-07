"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { ActionLogGetActionLogQueryParams } from "@/core/generated/zod/inputs";

import { logParams, PERIOD_CHOICES, TYPE_CHOICES } from "./filters";
import { getActionLog } from "./queries";
import { rowOf } from "./rows";

const { by, cursor, q } = ActionLogGetActionLogQueryParams.shape;

/** The next page of the Protokoll, or a search's first: each inside the filters the page's address holds. */
export const loadActionLog = action({
  lane: "admin",
  name: "loadActionLog",
  input: z.object({ query: q, cursor, by, type: z.enum(TYPE_CHOICES).nullish(), time: z.enum(PERIOD_CHOICES).nullish() }),
  run: async ({ query, cursor: after, ...filters }) => {
    const page = await getActionLog({ ...logParams(filters), q: query, cursor: after });
    return { ok: true, value: { rows: page.action_log.map(rowOf), cursor: page.cursor } };
  },
});
