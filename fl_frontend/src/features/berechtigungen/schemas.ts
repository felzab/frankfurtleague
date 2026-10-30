import z from "zod";

import { asSignInIdentifier, isSignInLibraryAddress } from "@/core/emailAddress";
import { CustomObjectIdStringSchema, KontaktEmailSchema } from "@/shared/schemas";

/** The two tiers a grant holds, refused in German: the tier change's input names one. */
const FLVerwaltungSchema = z.enum(["owner", "administration"], { error: "Diese Stufe gibt es nicht." });

/**
 * The grant's draft, the address alone: no tier travels, the application granting `administration` only. Held
 * to the sign-in library's own rule besides the address box's, since a grant it refuses admits nobody.
 */
export const FLPostBerechtigungPayloadSchema = z.object({
  email: KontaktEmailSchema.refine((email) => isSignInLibraryAddress(asSignInIdentifier(email)), {
    error: "Bitte gib eine gültige E-Mail-Adresse ein.",
  }),
});

/** The revoke's input: the grant the row names, which the call puts in its path. */
export const FLBerechtigungKeyPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLBerechtigungKeyPayload = z.infer<typeof FLBerechtigungKeyPayloadSchema>;

/**
 * The tier change's input: the grant in the path and the tier alone in the body. Naming the tier the grant already
 * holds changes nothing and answers as done, so a repeated press is no refusal.
 */
export const FLPatchBerechtigungPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
  verwaltung: FLVerwaltungSchema,
});
export type FLPatchBerechtigungPayload = z.infer<typeof FLPatchBerechtigungPayloadSchema>;

/** A request's approval and its refusal or withdrawal, each naming its request by the id in the path, with no body. */
export const FLBerechtigungAntragKeyPayloadSchema = z.object({
  id: CustomObjectIdStringSchema,
});
export type FLBerechtigungAntragKeyPayload = z.infer<typeof FLBerechtigungAntragKeyPayloadSchema>;
