import "server-only";

import { requires } from "@/core/action";
import { grantsPostGrantBodyEmailMax } from "@/core/generated/zod/inputs";
import { SignInAddressSchema } from "@/features/auth/schemas";

import { GRANT_ID } from "./schemas";

export const GRANT_RULES = {
  required: { email: requires(SignInAddressSchema, ""), grant_id: requires(GRANT_ID, "") },
  max: { email: grantsPostGrantBodyEmailMax },
} as const;
