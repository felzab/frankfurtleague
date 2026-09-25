import { apiClient } from "@/core/api";
import { APIBadStatusError } from "@/core/errors";
import { isRefusal, isRuleRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { alterAusserhalb } from "./constants";
import { postSchiedsrichterBestaetigungAnsicht } from "./mutations";
import { FLSchiedsrichterListResponseSchema, FLSchiedsrichterSingleResponseSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLSchiedsrichterListResponse, FLSchiedsrichterSingleResponse } from "./schemas";
import type { FLSchiedsrichterFilterParams, SchiedsrichterAnsicht, SchiedsrichterLinkZustand } from "./types";

/**
 * Every referee, with their contact details, school and fee. Admin-tier: a referee is a pupil
 * (`READ-CONTACT-001`), and the fee is money (`READ-MONEY-001`).
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getSchiedsrichter(filters: FLSchiedsrichterFilterParams = {}): Promise<FLSchiedsrichterListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runWithIncomingTrace(() =>
    apiClient<FLSchiedsrichterListResponse>("/schiedsrichter", FLSchiedsrichterListResponseSchema, {
      authType: "admin",
      params: filters,
    }),
  );
}

/**
 * One referee by id, whatever state they are in — an erased one has no row for it to answer with,
 * and the list above is narrowed besides.
 *
 * **Uncached** for the reason the list is.
 */
export async function getSchiedsrichterById(schiedsrichterId: string): Promise<FLSchiedsrichterSingleResponse | null> {
  return runWithIncomingTrace(() =>
    // `null` for "no such referee", which the editor page turns into `notFound()`. Every other
    // status still throws.
    apiClient<FLSchiedsrichterSingleResponse>(`/schiedsrichter/${schiedsrichterId}`, FLSchiedsrichterSingleResponseSchema, {
      authType: "admin",
    }).catch((error: unknown) => {
      if (error instanceof APIBadStatusError && error.statusCode === 404) return null;
      throw error;
    }),
  );
}

/**
 * A refused read as the panel it renders, or `null` where the read failed instead.
 *
 * A token the backend will not parse matches no record, so the page calls the link void rather than
 * offering a reload that cannot succeed.
 */
export function mapSchiedsrichterAnsichtRefusal(error: unknown): "ungueltig" | null {
  if (!isRefusal(error)) return null;

  if (error.serverErrorCode === "REQ-VAL-001") return "ungueltig";

  // Every rule's refusal alike, as the refused payload is: a confirmed or lapsed link answers its own
  // state in a 200, so a refusal is a token nothing could place, and a code nobody planned reads the same way.
  return isRuleRefusal(error) ? "ungueltig" : null;
}

export type SchiedsrichterBestaetigungRefusal = {
  error?: string;
  fieldErrors?: FieldErrors;
  unplacedError?: string;
  zustand?: SchiedsrichterLinkZustand;
};

// A thunk, never a number: the floor is read for the age arm alone, and a caller resolving it first
// answers the three arms that SPEND the link out of a second read, which finds nothing to read.
/**
 * `null` where the code is none of these. The floor comes from the token's own read: a number of
 * this mapper's own would be a second copy of one the endpoint alone decides.
 */
export async function mapSchiedsrichterBestaetigungRefusal(
  error: unknown,
  mindestalter: () => Promise<number | null>,
): Promise<SchiedsrichterBestaetigungRefusal | null> {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refusal no box can take is of a drifted client, which the
    // mail's link replaces.
    case "REQ-VAL-001":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    // The page offers no media switch below the served age, so only a page older than that rule
    // sends this answer, and its repair is the refused payload's.
    case "REQ-SCHIEDSRICHTER-008":
      return { error: ANTWORT_NEU_OEFFNEN };
    case "REQ-SCHIEDSRICHTER-002":
      return { zustand: "ungueltig" };
    case "REQ-SCHIEDSRICHTER-003":
      return { zustand: "abgelaufen" };
    case "REQ-SCHIEDSRICHTER-004":
      return { zustand: "bestaetigt" };
    // The one refusal that spends nothing, so it lands on the field and the typed date survives it;
    // a `zustand` here would swap a live form for a dead-link panel.
    case "REQ-SCHIEDSRICHTER-005": {
      const floor = await mindestalter();

      // Unworded rather than guessed: a sentence naming a floor this link was not minted under
      // sends the person to correct a date that was right.
      return floor === null ? null : { fieldErrors: { geburtsdatum: alterAusserhalb(floor) } };
    }
    default:
      return null;
  }
}

/**
 * What one link opens, narrowed here and never at the page, which would carry the name in its
 * payload regardless: a dead link's panel names nobody, and an open link with no name left has
 * nobody to name.
 */
export async function getSchiedsrichterBestaetigungAnsicht(token: string): Promise<SchiedsrichterAnsicht> {
  return runWithIncomingTrace(() =>
    postSchiedsrichterBestaetigungAnsicht({ token: token }).then(
      (ansicht) =>
        ansicht.zustand === "gueltig"
          ? ansicht.vorname === null
            ? { zustand: "ungueltig" as const }
            : { zustand: "gueltig" as const, ansicht: { ...ansicht, vorname: ansicht.vorname } }
          : { zustand: ansicht.zustand },
      (error: unknown) => {
        // Anything but a refusal is a failed read, which is the page's own state rather than a panel
        // calling a live link void.
        const zustand = mapSchiedsrichterAnsichtRefusal(error);
        if (zustand !== null) return { zustand: zustand };
        throw error;
      },
    ),
  );
}
