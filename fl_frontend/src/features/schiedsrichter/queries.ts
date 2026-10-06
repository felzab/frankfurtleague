import { cache } from "react";

import { apiClient } from "@/core/api";
import { isRecordMissing } from "@/core/errors";
import { isRefusal, isRuleRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";
import { ANTWORT_NEU_OEFFNEN, FASSUNG_NEU_OEFFNEN } from "@/shared/utils/reopenLink";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { alterAusserhalb } from "./constants";
import { postSchiedsrichterAdresswechselAnsicht, postSchiedsrichterBestaetigungAnsicht } from "./mutations";
import { FLSchiedsrichterListResponseSchema, FLSchiedsrichterSelbstResponseSchema, FLSchiedsrichterSingleResponseSchema } from "./schemas";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLSchiedsrichterListResponse, FLSchiedsrichterSelbstResponse, FLSchiedsrichterSingleResponse } from "./schemas";
import type {
  AdresswechselAnsicht,
  AdresswechselLinkZustand,
  FLSchiedsrichterFilterParams,
  SchiedsrichterAnsicht,
  SchiedsrichterLinkZustand,
} from "./types";

/**
 * Every referee, with their contact details, school and fee. Admin-tier: a referee is a pupil
 * (`READ-CONTACT-001`), and the fee is money (`READ-MONEY-001`).
 *
 * **Uncached, and it stays uncached**: `"use cache"` keys on arguments, not on caller identity.
 */
export async function getSchiedsrichter(filters: FLSchiedsrichterFilterParams = {}): Promise<FLSchiedsrichterListResponse> {
  // No cache tag either: one means nothing outside a cache scope.
  return runAdminRead(() =>
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
  return runAdminRead(() =>
    // `null` for "no such referee", which the editor page turns into `notFound()`. Every other
    // status still throws.
    apiClient<FLSchiedsrichterSingleResponse>(`/schiedsrichter/${schiedsrichterId}`, FLSchiedsrichterSingleResponseSchema, {
      authType: "admin",
    }).catch((error: unknown) => {
      if (isRecordMissing(error)) return null;
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
// answers every arm naming the link's state out of a second read, which finds nothing to read.
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
    case "REQ-VAL-002":
    case "REQ-VAL-001":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    // The page offers no media switch below the served age, so only a page older than that rule
    // sends this answer, and its repair is the refused payload's.
    case "REQ-SCHIEDSRICHTER-008":
      return { error: ANTWORT_NEU_OEFFNEN };
    // The backend's judgement of the label (`docs/backend/spec.md :: I550`): a page opened before a
    // deploy moved it posts words other than those the backend runs, and only the mail's link reopens it.
    case "REQ-EINWILLIGUNG-001":
      return { error: FASSUNG_NEU_OEFFNEN };
    case "REQ-SCHIEDSRICHTER-002":
      return { zustand: "ungueltig" };
    case "REQ-SCHIEDSRICHTER-003":
      return { zustand: "abgelaufen" };
    case "REQ-SCHIEDSRICHTER-004":
      return { zustand: "bestaetigt" };
    // The panel the view opens a barred link on, so a ban entered while the form stood open leaves no form either.
    case "REQ-SCHIEDSRICHTER-009":
      return { zustand: "gesperrt" };
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

/**
 * What one address link opens, narrowed here for the consent link's reason: a dead link's panel
 * names nobody, and an open one with no name left has nobody to name.
 */
export async function getSchiedsrichterAdresswechselAnsicht(token: string): Promise<AdresswechselAnsicht> {
  return runWithIncomingTrace(() =>
    postSchiedsrichterAdresswechselAnsicht({ token: token }).then(
      (ansicht): AdresswechselAnsicht =>
        ansicht.zustand !== "gueltig"
          ? { zustand: ansicht.zustand }
          : ansicht.vorname === null
            ? { zustand: "ungueltig" }
            : { zustand: "gueltig", vorname: ansicht.vorname, frist: ansicht.frist },
      (error: unknown): AdresswechselAnsicht => {
        // The consent link's reading of a refused read: a token nothing could place.
        const zustand = mapSchiedsrichterAnsichtRefusal(error);
        if (zustand !== null) return { zustand: zustand };
        throw error;
      },
    ),
  );
}

export type SchiedsrichterAdresswechselRefusal = {
  error?: string;
  fieldErrors?: FieldErrors;
  unplacedError?: string;
  zustand?: AdresswechselLinkZustand;
};

/** A refused answer as the panel or the sentence the address page shows, or `null` where the code is none of these. */
export function mapSchiedsrichterAdresswechselRefusal(error: unknown): SchiedsrichterAdresswechselRefusal | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refused one is a drifted page, which the mail's link replaces.
    case "REQ-VAL-002":
    case "REQ-VAL-001":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    case "REQ-SCHIEDSRICHTER-002":
      return { zustand: "ungueltig" };
    case "REQ-SCHIEDSRICHTER-003":
      return { zustand: "abgelaufen" };
    case "REQ-SCHIEDSRICHTER-009":
      return { zustand: "gesperrt" };
    // A ban entered on the replaced address after the page opened: the panel the view opens on then.
    case "REQ-SCHIEDSRICHTER-010":
      return { zustand: "nicht_bestaetigbar" };
    default:
      return null;
  }
}

/**
 * The signed-in referee's own records, refused `REQ-FUNKTION-001` where the backend holds no confirmed
 * referee row for the address the page's own check passed.
 */
// Never `"use cache"`, which keys on the arguments rather than the caller (`docs/frontend/spec.md` §1.2).
export const getSchiedsrichterSelbst = cache(async (): Promise<FLSchiedsrichterSelbstResponse> =>
  runPersonRead(() =>
    apiClient<FLSchiedsrichterSelbstResponse>("/schiedsrichter/selbst", FLSchiedsrichterSelbstResponseSchema, { authType: "admin" }),
  ),
);
