import "server-only";

import { requires } from "@/core/action";
import { grantsPostGrantBodyEmailMax, GrantsPostHandoverParams } from "@/core/generated/zod/inputs";
import { SignInAddressSchema } from "@/features/auth/schemas";

export const GRANT_ID = GrantsPostHandoverParams.shape.grant_id;

/** Read on the server so the schemas never reach the browser. */
export const GRANT_RULES = {
  required: { email: requires(SignInAddressSchema, ""), grant_id: requires(GRANT_ID, "") },
  emailMax: grantsPostGrantBodyEmailMax,
} as const;
