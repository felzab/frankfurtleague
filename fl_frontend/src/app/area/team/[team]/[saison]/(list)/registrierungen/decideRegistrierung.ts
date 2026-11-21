"use server";

import { z } from "zod";

import { action } from "@/core/action";
import { registrierungenAdmit, registrierungenDecline } from "@/core/generated/client/sdk";
import {
  RegistrierungenAdmitBody,
  RegistrierungenAdmitParams,
  RegistrierungenDeclineBody,
  RegistrierungenDeclineParams,
} from "@/core/generated/zod/inputs";

/**
 * Admits one registration into the team's squad, into the person `spieler_id` names, or a new one where it names
 * nobody. The backend judges the seat against the registration's own team.
 */
export const admitRegistrierung = action({
  lane: "person",
  claim: "record",
  name: "admitRegistrierung",
  input: z.object({ ...RegistrierungenAdmitParams.shape, ...RegistrierungenAdmitBody.shape }),
  run: async ({ registrierung_id, spieler_id }) => {
    await registrierungenAdmit(registrierung_id, { spieler_id });
    return { ok: true, value: undefined };
  },
});

/** Declines one registration, for the closed reason or none, the backend judging the seat against its own team. */
export const declineRegistrierung = action({
  lane: "person",
  claim: "record",
  name: "declineRegistrierung",
  input: z.object({ ...RegistrierungenDeclineParams.shape, ...RegistrierungenDeclineBody.shape }),
  run: async ({ registrierung_id, reason }) => {
    await registrierungenDecline(registrierung_id, { reason });
    return { ok: true, value: undefined };
  },
});
