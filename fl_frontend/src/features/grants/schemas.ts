import "server-only";

import { requires } from "@/core/action";
import { asSignInIdentifier } from "@/core/emailAddress";
import { GrantsPostGrantBody, grantsPostGrantBodyEmailMax, GrantsPostHandoverParams } from "@/core/generated/zod/inputs";
import { isSignInLibraryAddress } from "@/core/signInLibraryAddress";

/**
 * The address to add, held to the sign-in library's own rule besides the published one: the backend takes addresses the
 * library refuses, and a grant at one admits nobody. Past this, the published rule's refusal stands on the box as
 * `email_not_accepted`.
 */
export const NEW_GRANT_EMAIL = GrantsPostGrantBody.shape.email.refine((email) => isSignInLibraryAddress(asSignInIdentifier(email)));

/** A grant an act names, a row's or the handover's select. */
export const GRANT_ID = GrantsPostHandoverParams.shape.grant_id;

/** What the owner's two dialogs ask of their boxes, read on the server so the schemas never reach the browser. */
export const GRANT_RULES = {
  required: { email: requires(NEW_GRANT_EMAIL, ""), grant_id: requires(GRANT_ID, "") },
  emailMax: grantsPostGrantBodyEmailMax,
} as const;
