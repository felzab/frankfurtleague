import { cache } from "react";

import { apiClient } from "@/core/api";
import { isRecordMissing } from "@/core/errors";
import { medienNochNicht } from "@/features/bewerbungen/utils";
import { ansichtOf } from "@/features/konto/adresswechselLink";
import { isRefusal, isRuleRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { runAdminRead } from "@/shared/utils/adminRead";
import { runPersonRead } from "@/shared/utils/personRead";
import { ANTWORT_NEU_OEFFNEN, FASSUNG_NEU_OEFFNEN } from "@/shared/utils/reopenLink";
import { runWithIncomingTrace } from "@/shared/utils/traceScope";

import { alterAusserhalb } from "./constants";
import { postSchiedsrichterAdresswechselAnsicht, postSchiedsrichterBestaetigungAnsicht } from "./mutations";
import { FLSchiedsrichterListResponseSchema, FLSchiedsrichterSelbstResponseSchema, FLSchiedsrichterSingleResponseSchema } from "./schemas";

import type { AdresswechselAnsicht, AdresswechselLinkZustand } from "@/features/konto/adresswechselLink";
import type { FieldErrors } from "@/shared/utils/validation";
import type { FLSchiedsrichterListResponse, FLSchiedsrichterSelbstResponse, FLSchiedsrichterSingleResponse } from "./schemas";
import type { FLSchiedsrichterFilterParams, SchiedsrichterAnsicht, SchiedsrichterLinkZustand } from "./types";

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

/** `alterAusserhalb` where the link's view serves no floor to name: both bounds, never a number of its own. */
const ALTER_AUSSERHALB_UNGELESEN = "Mit diesem Geburtsdatum bist Du zu jung oder zu alt.";

/** The link's own view, read again after a refused press: its floors where it is open, its state where not. */
export type GelesenerSchiedsrichterLink =
  | { readonly zustand: "gueltig"; readonly ansicht: { readonly mindestalter: number; readonly medien_mindestalter: number } }
  | { readonly zustand: SchiedsrichterLinkZustand };

// A thunk, never a resolved read: the codes naming one state alone answer without it, and a caller resolving it
// first spends a second backend read on each of them.
/**
 * `null` where the code is none of these. The floors come from the token's own read: a number of
 * this mapper's own would be a second copy of one the endpoint alone decides. `gelesen` answers `null`
 * where the read failed.
 */
export async function mapSchiedsrichterBestaetigungRefusal(
  error: unknown,
  gelesen: () => Promise<GelesenerSchiedsrichterLink | null>,
): Promise<SchiedsrichterBestaetigungRefusal | null> {
  if (!isRefusal(error)) return null;

  const ansicht = async () => {
    const link = await gelesen();
    return link?.zustand === "gueltig" ? link.ansicht : null;
  };
  // The panel a reload opens on, which the press's own panel stands in for where the read finds the link open or reads nothing.
  const stand = async (sonst: SchiedsrichterLinkZustand): Promise<SchiedsrichterLinkZustand> => {
    const link = await gelesen();
    return link === null || link.zustand === "gueltig" ? sonst : link.zustand;
  };

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refusal no box can take is of a drifted client, which the
    // mail's link replaces.
    case "REQ-VAL-002":
    case "REQ-VAL-001":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    // The switch is offered from the served age on the browser's day, so a clock disagreeing with the
    // backend's sends this, which a reopened link would offer again: switching it off is the repair.
    case "REQ-SCHIEDSRICHTER-008":
      return { error: medienNochNicht((await ansicht())?.medien_mindestalter ?? null) };
    // The backend's judgement of the label (`docs/backend/spec.md :: I550`): a page opened before a
    // deploy moved it posts words other than those the backend runs, and only the mail's link reopens it.
    case "REQ-EINWILLIGUNG-001":
      return { error: FASSUNG_NEU_OEFFNEN };
    case "REQ-SCHIEDSRICHTER-002":
      return { zustand: "ungueltig" };
    // Judged ahead of the ban, which the view ranks first: an address barred since reads as a reload shows it.
    case "REQ-SCHIEDSRICHTER-003":
      return { zustand: await stand("abgelaufen") };
    case "REQ-SCHIEDSRICHTER-004":
      return { zustand: await stand("bestaetigt") };
    // The panel the view opens a barred link on, so a ban entered while the form stood open leaves no form either.
    case "REQ-SCHIEDSRICHTER-009":
      return { zustand: "gesperrt" };
    // The one refusal that spends nothing, so it lands on the field and the typed date survives it;
    // a `zustand` here would swap a live form for a dead-link panel.
    case "REQ-SCHIEDSRICHTER-005": {
      const floor = (await ansicht())?.mindestalter ?? null;

      // A view that went unread names no floor: one guessed could send the person to correct a date that was right.
      return { fieldErrors: { geburtsdatum: floor === null ? ALTER_AUSSERHALB_UNGELESEN : alterAusserhalb(floor) } };
    }
    default:
      return null;
  }
}

/**
 * What one link opens, narrowed here and never at the page, which would carry the link's floors and
 * wording in its payload regardless: a dead link's panel carries nothing of the entry.
 */
export async function getSchiedsrichterBestaetigungAnsicht(token: string): Promise<SchiedsrichterAnsicht> {
  return runWithIncomingTrace(() =>
    postSchiedsrichterBestaetigungAnsicht({ token: token }).then(
      (ansicht): SchiedsrichterAnsicht =>
        ansicht.zustand === "gueltig" ? { zustand: "gueltig", ansicht: ansicht } : { zustand: ansicht.zustand },
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

/** What one address link opens, the pupil's twin (`fl_frontend/src/features/spieler/queries.ts :: getSpielerAdresswechselAnsicht`). */
export async function getSchiedsrichterAdresswechselAnsicht(token: string): Promise<AdresswechselAnsicht> {
  return runWithIncomingTrace(() =>
    postSchiedsrichterAdresswechselAnsicht({ token: token }).then(ansichtOf, (error: unknown): AdresswechselAnsicht => {
      // The consent link's reading of a refused read: a token nothing could place.
      const zustand = mapSchiedsrichterAnsichtRefusal(error);
      if (zustand !== null) return { zustand: zustand };
      throw error;
    }),
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
    // A ban entered on the replaced address after the page opened, or a pupil row at it that would move onto
    // an address another pupil holds: one panel, so the link's holder learns nothing about who holds an address.
    case "REQ-SCHIEDSRICHTER-010":
    case "REQ-SPIELER-006":
    case "DB-COMMON-002":
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
