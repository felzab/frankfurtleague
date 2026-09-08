import "server-only";

import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { formatLogLine, LOG_THRESHOLDS } from "./logFormat";

// Read off `createEnv` rather than imported: the package declaring the Standard Schema issue is a
// transitive dependency, and pnpm puts none of those on this module's resolution path.
type ValidationIssues = Parameters<NonNullable<Parameters<typeof createEnv>[0]["onValidationError"]>>[0];

// Printable ASCII with no space, the class `fl_backend/app/core/config.py :: InternalAPIKey` pins:
// `secrets.compare_digest` there raises for a non-ASCII key, and `length` counts UTF-16 units here
// against that side's code points, so only ASCII makes the two agree (`docs/ops/spec.md :: I11`).
export const INTERNAL_API_KEY = z
  .string()
  .length(64)
  .regex(/^[\x21-\x7e]+$/, "every character must be printable ASCII, and none may be a space");

export function refuseInvalidEnvironment(names: readonly string[]): never {
  // Read off the raw variable, which may itself be the invalid one, so anything but `json` falls
  // to the console shape.
  const format = process.env.LOG_FORMAT?.toLowerCase() === "json" ? "json" : "console";
  // The class the backend's boot refusals take (`docs/logging/error-codes.md` §3).
  const meta = { error_code: "FE-BOOT-001", variables: names.join(", ") };
  // The formatter rather than the logger: `logging.ts` imports this module, and importing it back
  // would close the cycle.
  process.stdout.write(formatLogLine(format, "CRITICAL", "Invalid environment variables", meta) + "\n");

  throw new Error(`Invalid environment variables: ${names.join(", ")}`);
}

type IssuePathSegment = NonNullable<ValidationIssues[number]["path"]>[number];

// A Standard Schema segment is a key OR a `{ key }` wrapper around one, and `String` on the wrapper
// renders `[object Object]` — a boot refusal naming no variable anybody can go and fix.
function variableName(segment: IssuePathSegment | undefined): string {
  if (segment === undefined) return "<unknown>";

  return String(typeof segment === "object" ? segment.key : segment);
}

// Names only: the default handler prints the whole issue array, one schema change away from
// echoing a rejected value into a container log (`docs/ops/spec.md :: I179`).
export function failingVariableNames(issues: ValidationIssues): string[] {
  return [...new Set(issues.map((issue) => variableName(issue.path?.[0])))].sort();
}

// Bound to a name rather than written inside the call, so `DECLARED_ENVIRONMENT_NAMES` can be read
// off the schema itself: a hand-kept copy of those names would be a second artefact to keep current.
const server = {
  // The public origin reaches FastAPI on the liveness path alone, so an API_URL sharing
  // AUTH_URL's origin leaves the footer's probe green while Next's 404 answers every other
  // call (`docs/ops/spec.md :: I13`). Caught at boot: that shape reads as healthy.
  API_URL: z.url().refine((raw) => {
    const authUrl = process.env.AUTH_URL;
    return !authUrl || new URL(raw).origin !== new URL(authUrl).origin;
  }, "API_URL must reach the backend directly, not through the public origin AUTH_URL names"),
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

  // Stricter than `svix`, which verifies with the prefix or without it: refusing at boot beats a 400
  // the provider retries for thirty-two hours before disabling the endpoint.
  RESEND_WEBHOOK_SECRET: z.string().startsWith("whsec_", "the signing secret Resend shows on the webhook's detail page starts with whsec_"),

  INTERNAL_API_KEY_BASE: INTERNAL_API_KEY,
  INTERNAL_API_KEY_SYSTEM: INTERNAL_API_KEY,
  INTERNAL_API_KEY_ADMIN: INTERNAL_API_KEY,

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

  // Defaulted so no server .env is touched to keep INFO the floor, and upper-cased before the
  // enum because the level words are the ones that appear on a log line.
  LOG_LEVEL: z
    .string()
    .transform((value) => value.toUpperCase())
    .pipe(z.enum(LOG_THRESHOLDS))
    .default("INFO"),

  // Defaulted so no server .env is touched to arm the retention sweep, and an enum rather than
  // `z.coerce.boolean()`, which reads the string "false" as true and settles before a default
  // could apply.
  BEWERBUNG_SWEEP: z
    .string()
    .transform((value) => value.toLowerCase())
    .pipe(z.enum(["on", "off"]))
    .default("on"),
};

const client = {};

export const frontend_config = createEnv({
  server,
  client,

  skipValidation: process.env.SKIP_ENV_VALIDATION === "true",

  onValidationError: (issues) => refuseInvalidEnvironment(failingVariableNames(issues)),

  runtimeEnv: {
    API_URL: process.env.API_URL,
    API_VERSION: process.env.API_VERSION,

    MONGODB_URI: process.env.MONGODB_URI,

    AUTH_URL: process.env.AUTH_URL,
    AUTH_SECRET: process.env.AUTH_SECRET,
    AUTH_RESEND_KEY: process.env.AUTH_RESEND_KEY,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,

    INTERNAL_API_KEY_BASE: process.env.INTERNAL_API_KEY_BASE,
    INTERNAL_API_KEY_SYSTEM: process.env.INTERNAL_API_KEY_SYSTEM,
    INTERNAL_API_KEY_ADMIN: process.env.INTERNAL_API_KEY_ADMIN,

    ALLOWED_ADMIN_EMAILS: process.env.ALLOWED_ADMIN_EMAILS,

    LOG_FORMAT: process.env.LOG_FORMAT,
    LOG_LEVEL: process.env.LOG_LEVEL,
    BEWERBUNG_SWEEP: process.env.BEWERBUNG_SWEEP,
  },
});

/**
 * `scripts/ops/deploy.sh :: check_frontend_env_names` refuses a deploy whose environment file carries a name
 * outside this set: nothing in this schema reads one, so it reads as omitted and the shipped default
 * serves production.
 */
export const DECLARED_ENVIRONMENT_NAMES: readonly string[] = Object.keys({ ...server, ...client }).sort();
