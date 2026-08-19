import "server-only";

import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const frontend_config = createEnv({
  server: {
    API_URL: z.url(),
    API_VERSION: z.coerce.number().int(),

    MONGODB_URI: z.string().regex(/^(mongodb(?:\+srv)?):\/\/.+/, "MongoDB URI must start with 'mongodb://' or 'mongodb+srv://'"),

    // @auth/core derives the session cookie's `Secure` flag from this protocol, so a stray http://
    // ships an admin cookie in plaintext. Gated on the host, not NODE_ENV: the local stack sets it
    // to production too.
    AUTH_URL: z.url().refine((raw) => {
      const { protocol, hostname } = new URL(raw);
      return protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
    }, "AUTH_URL must use https:// unless it points at localhost"),
    AUTH_SECRET: z.string(),
    AUTH_RESEND_KEY: z.string(),

    INTERNAL_API_KEY_BASE: z.string().length(64),
    INTERNAL_API_KEY_SYSTEM: z.string().length(64),
    INTERNAL_API_KEY_ADMIN: z.string().length(64),

    ALLOWED_ADMIN_EMAILS: z
      .string()
      .transform((str) => str.split(",").map((s) => s.trim().toLowerCase()))
      .pipe(z.array(z.email())),

    // An enum over a normalised value, not a bare string: the json branch is selected by exact
    // comparison, so a capitalised one would fall through to colourised output in production.
    LOG_FORMAT: z
      .string()
      .transform((value) => value.toLowerCase())
      .pipe(z.enum(["console", "json"])),
  },

  client: {},

  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",

  // Names only: the default handler prints the whole issue array, one schema change away from
  // echoing a rejected value into a container log.
  onValidationError: (issues) => {
    const names = [...new Set(issues.map((issue) => String(issue.path?.[0] ?? "<unknown>")))].sort();
    throw new Error(`Invalid environment variables: ${names.join(", ")}`);
  },

  runtimeEnv: {
    API_URL: process.env.API_URL,
    API_VERSION: process.env.API_VERSION,

    MONGODB_URI: process.env.MONGODB_URI,

    AUTH_URL: process.env.AUTH_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_RESEND_KEY: process.env.AUTH_RESEND_KEY,

    INTERNAL_API_KEY_BASE: process.env.INTERNAL_API_KEY_BASE,
    INTERNAL_API_KEY_SYSTEM: process.env.INTERNAL_API_KEY_SYSTEM,
    INTERNAL_API_KEY_ADMIN: process.env.INTERNAL_API_KEY_ADMIN,

    ALLOWED_ADMIN_EMAILS: process.env.ALLOWED_ADMIN_EMAILS,

    LOG_FORMAT: process.env.LOG_FORMAT,
  },
});
