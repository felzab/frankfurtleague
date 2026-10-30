import { cache } from "react";

import { ContractBreakError } from "@/core/errors";
import { spielbestaetigungenGetSelf, spielbestaetigungenGetSpielbestaetigungen } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";
import { getGermanTodayStr } from "@/shared/utils/date";
import { runPersonRead } from "@/shared/utils/personRead";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

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
 * The signed-in referee's own rows, refused `funktion_nicht_gehalten` where the backend holds no confirmed referee record
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
      (ansicht): SpielbestaetigungAnsicht => {
        const { zustand } = ansicht;
        if (zustand === "gueltig" || zustand === "vorschlag") return { zustand: zustand, ansicht: ansicht };
        // The view serves no close reason, so the day the link asked about decides, on Berlin's calendar as the
        // backend's: a link to a match already due must not say the league will still set its date.
        if (zustand === "abgelaufen" && ansicht.ansetzung.datum < getGermanTodayStr()) return { zustand: "termin-vorbei" };
        if (zustand === "verworfen")
          return { zustand: zustand, termin: { datum: ansicht.ansetzung.datum, uhrzeit: ansicht.ansetzung.uhrzeit } };
        if (zustand !== "zugesagt" && zustand !== "abgelehnt") return { zustand: zustand };

        // The role is a seat and never a person, and it is what tells the club's other two seats who
        // answered. An answered view naming none breaks the contract, which the error boundary logs.
        if (ansicht.beantwortet_von === null) throw new ContractBreakError(`the ${zustand} view names no answering role`);
        return { zustand: zustand, beantwortet_von: ansicht.beantwortet_von };
      },
      (error: unknown) => {
        // Anything but a refusal is a failed read, which is the page's own state rather than a panel
        // calling a live link void.
        const zustand = mapAnsetzungAnsichtRefusal(error);
        if (zustand !== null) return { zustand: zustand };
        throw error;
      },
    ),
  );
}
