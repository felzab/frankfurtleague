import { cache } from "react";

import { ContractBreakError } from "@/core/errors";
import { spielbestaetigungenGetSelf, spielbestaetigungenGetSpielbestaetigungen } from "@/core/generated/client/sdk";
import { runWithIncomingTrace } from "@/core/traceScope";
import { runAdminRead } from "@/shared/utils/adminRead";
import { getGermanTodayStr } from "@/shared/utils/date";
import { runPersonRead } from "@/shared/utils/personRead";

import { postSpielbestaetigungAnsicht } from "./mutations";
import { mapAnsetzungAnsichtRefusal } from "./utils";

import type {
  FLSpielbestaetigungenListResponse,
  FLSpielbestaetigungenSelfResponse,
  SpielbestaetigungenGetSpielbestaetigungenParams,
} from "@/core/generated/client/types";
import type { SpielbestaetigungAnsicht } from "./utils";

/** Uncached, as every admin-tier read is: `"use cache"` keys on the arguments, never on the administrator asking. */
export async function getSpielbestaetigungen(
  filters: SpielbestaetigungenGetSpielbestaetigungenParams,
): Promise<FLSpielbestaetigungenListResponse> {
  return runAdminRead(() => spielbestaetigungenGetSpielbestaetigungen(filters));
}

/**
 * The signed-in referee's own rows, refused `role_not_held` where the backend holds no confirmed referee record
 * for the address the page's own check passed.
 */
// Never `"use cache"`, which keys on the arguments rather than the caller.
export const getEigeneSpielbestaetigungen = cache(async (): Promise<FLSpielbestaetigungenSelfResponse> =>
  runPersonRead(() => spielbestaetigungenGetSelf()),
);

/**
 * One link's standing, read on every open and stored nowhere: a GET records nothing, not even a
 * visit, because mail scanners fetch every link in a message.
 */
export async function getSpielbestaetigungAnsicht(token: string): Promise<SpielbestaetigungAnsicht> {
  return runWithIncomingTrace(() =>
    postSpielbestaetigungAnsicht({ token: token }).then(
      // Narrowed here and never at the page, which would carry the clubs, the date and the proposal
      // regardless: a dead link's panel names nothing of the fixture, an answered one the seat alone.
      (view): SpielbestaetigungAnsicht => {
        const { state: state } = view;
        if (state === "valid" || state === "vorschlag") return { zustand: state, ansicht: view };
        // The view serves no close reason, so the day the link asked about decides, on Berlin's calendar as the
        // backend's: a link to a match already due must not say the league will still set its date.
        if (state === "expired" && view.ansetzung.datum < getGermanTodayStr()) return { zustand: "termin-vorbei" };
        if (state === "discarded") return { zustand: state, appointment: { datum: view.ansetzung.datum, uhrzeit: view.ansetzung.uhrzeit } };
        if (state !== "zugesagt" && state !== "declined") return { zustand: state };

        // The role is a seat and never a person, and it is what tells the club's other two seats who
        // answered. An answered view naming none breaks the contract, which the error boundary logs.
        if (view.answered_by === null) throw new ContractBreakError(`the ${state} view names no answering role`);
        return { zustand: state, answered_by: view.answered_by };
      },
      (error: unknown) => {
        // Anything but a refusal is a failed read, which is the page's own state rather than a panel
        // calling a live link void.
        const state = mapAnsetzungAnsichtRefusal(error);
        if (state !== null) return { zustand: state };
        throw error;
      },
    ),
  );
}
