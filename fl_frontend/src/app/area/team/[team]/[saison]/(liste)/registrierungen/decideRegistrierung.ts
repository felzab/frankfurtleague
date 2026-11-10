"use server";

import { action } from "@/core/action";
import {
  RegistrierungenAdmitBody,
  RegistrierungenAdmitParams,
  RegistrierungenDeclineBody,
  RegistrierungenDeclineParams,
  RegistrierungenGetOpenRegistrierungenParams,
} from "@/core/generated/zod/inputs";
import { postRegistrierungAdmit, postRegistrierungDecline } from "@/features/registrierungen/mutations";

/**
 * Admits one registration into the team's squad, into the person `spieler_id` names, or a new one where it names
 * nobody. Claimed on the seat the page stands at; the backend judges the seat again against the registration's own team.
 */
export const admitRegistrierung = action({
  lane: "person",
  claim: "seat",
  name: "admitRegistrierung",
  input: RegistrierungenGetOpenRegistrierungenParams.extend(RegistrierungenAdmitParams.shape).extend(RegistrierungenAdmitBody.shape),
  ownWords: ["kader_full", "registrierung_already_in_kader", "registrierung_stufe_not_allowed"],
  run: async ({ registrierung_id, spieler_id }) => {
    await postRegistrierungAdmit(registrierung_id, { spieler_id });
    return { ok: true, value: undefined };
  },
});

/** Declines one registration, for the closed reason or none, at the seat the page stands at. */
export const declineRegistrierung = action({
  lane: "person",
  claim: "seat",
  name: "declineRegistrierung",
  input: RegistrierungenGetOpenRegistrierungenParams.extend(RegistrierungenDeclineParams.shape).extend(RegistrierungenDeclineBody.shape),
  run: async ({ registrierung_id, reason }) => {
    await postRegistrierungDecline(registrierung_id, { reason });
    return { ok: true, value: undefined };
  },
});
