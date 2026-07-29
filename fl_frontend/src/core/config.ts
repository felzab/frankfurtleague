// src/core/env.ts
import "server-only";

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
    // @auth/core derives the session cookie's `Secure` flag from this URL's protocol, so a stray
    // http:// value silently ships an admin session cookie that travels in plaintext. Gated on the
    // host rather than NODE_ENV: the runner image sets NODE_ENV=production for the local stack too,
    // which serves http://localhost:3000 (docker-compose.local.yml).
    AUTH_URL: z.url().refine((raw) => {
      const { protocol, hostname } = new URL(raw);
      return protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
    }, "AUTH_URL must use https:// unless it points at localhost"),
    // Prefer the canonical URL over the literal "true": "true" tells Auth.js to trust the forwarded
    // Host, which nginx passes through unvalidated. Harmless while AUTH_URL above is mandatory --
    // Auth.js derives its base URL from that -- but the URL branch removes the dependency entirely.
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

    // logging
    LOG_FORMAT: z.string(),
  },

  // Must start with NEXT_PUBLIC_
  client: {},

  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",

  // Names only. The default handler prints the whole issue array, which is fine today but is one
  // schema change away from echoing a rejected value into a container log. Cannot use
  // src/core/logging.ts here -- it reads this module, so it is unavailable while this is failing.
  onValidationError: (issues) => {
    const names = [...new Set(issues.map((issue) => String(issue.path?.[0] ?? "<unknown>")))].sort();
    throw new Error(`Invalid environment variables: ${names.join(", ")}`);
  },

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

    LOG_FORMAT: process.env.LOG_FORMAT,
  },
});
