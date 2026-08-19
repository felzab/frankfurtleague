/**
 * CORE · environment validation
 *
 * The startup gate. Every server environment variable is declared and validated here; a missing
 * or malformed one stops the process before it serves traffic.
 *
 * Invariants:
 * - Validation failure prints NAMES ONLY — the default handler would echo values into the log.
 * - `AUTH_URL` must be https unless loopback.
 * - `SKIP_ENV_VALIDATION=true` bypasses the gate — the Docker builder stage, which has no env.
 * - This module cannot use `core/logging.ts`: logging reads this module.
 *
 * See:
 * - docs/frontend/spec.md — section 1.7, the full variable table
 */

import "server-only";

import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const frontend_config = createEnv({
  server: {
    API_URL: z.url(),
    API_VERSION: z.coerce.number().int(),

    MONGODB_URI: z.string().regex(/^(mongodb(?:\+srv)?):\/\/.+/, "MongoDB URI must start with 'mongodb://' or 'mongodb+srv://'"),

    // Auth. @auth/core derives the session cookie's `Secure` flag from this URL's
    // protocol, so a stray http:// ships an admin cookie in plaintext. Gated on
    // the host, not NODE_ENV, which the local stack also sets to production.
    AUTH_URL: z.url().refine((raw) => {
      const { protocol, hostname } = new URL(raw);
      return protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
    }, "AUTH_URL must use https:// unless it points at localhost"),
    // AUTH_TRUST_HOST is deliberately NOT declared: @auth/core reads it only after
    // `AUTH_URL`, which is mandatory above. What stops a forged Host header is that
    // plus nginx's catch-all default_server block.
    AUTH_SECRET: z.string(),
    AUTH_RESEND_KEY: z.string(),

    INTERNAL_API_KEY_BASE: z.string().length(64),
    INTERNAL_API_KEY_SYSTEM: z.string().length(64),
    INTERNAL_API_KEY_ADMIN: z.string().length(64),

    ALLOWED_ADMIN_EMAILS: z
      .string()
      .transform((str) => str.split(",").map((s) => s.trim().toLowerCase()))
      .pipe(z.array(z.email())),

    // Logging. An enum, not a bare string: the json branch is selected by exact
    // comparison, so a capitalised value falls through to ANSI-colourised output
    // inside a production container. Case is normalised first, as the backend does.
    LOG_FORMAT: z
      .string()
      .transform((value) => value.toLowerCase())
      .pipe(z.enum(["console", "json"])),
  },

  client: {},

  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",

  // Names only: the default handler prints the whole issue array, one schema
  // change away from echoing a rejected value into a container log. `core/logging`
  // is unavailable here -- it reads this module.
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
