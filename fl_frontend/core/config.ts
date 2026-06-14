// src/core/env.ts
import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const frontend_config = createEnv({
  server: {
    // Backend (API)
    API_URL: z.url(),
    API_VERSION: z.coerce.number().int(),

    // MongoDB
    MONGODB_URI: z.string().regex(/^(mongodb(?:\+srv)?):\/\/.+/, "MongoDB URI must start with 'mongodb://' or 'mongodb+srv://'"),

    // Auth
    AUTH_URL: z.url(),
    AUTH_TRUST_HOST: z.union([z.literal("true"), z.url()]),
    AUTH_SECRET: z.string(),
    AUTH_RESEND_KEY: z.string(),

    // For request validation
    INTERNAL_API_KEY_BASE: z.string().length(64),
    INTERNAL_API_KEY_SYSTEM: z.string().length(64),
    INTERNAL_API_KEY_ADMIN: z.string().length(64),

    // For admin login
    ALLOWED_ADMIN_EMAILS: z
      .string()
      .transform((str) => str.split(",").map((s) => s.trim().toLowerCase()))
      .pipe(z.array(z.email())),
  },

  // Must start with NEXT_PUBLIC_
  client: {},

  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",

  runtimeEnv: {
    API_URL: process.env.API_URL,
    API_VERSION: process.env.API_VERSION,

    MONGODB_URI: process.env.MONGODB_URI,

    AUTH_URL: process.env.AUTH_URL,
    AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_RESEND_KEY: process.env.AUTH_RESEND_KEY,

    INTERNAL_API_KEY_BASE: process.env.INTERNAL_API_KEY_BASE,
    INTERNAL_API_KEY_SYSTEM: process.env.INTERNAL_API_KEY_SYSTEM,
    INTERNAL_API_KEY_ADMIN: process.env.INTERNAL_API_KEY_ADMIN,

    ALLOWED_ADMIN_EMAILS: process.env.ALLOWED_ADMIN_EMAILS,
  },
});
