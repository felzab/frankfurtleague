import "server-only";

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

import { BootRefusal } from "./bootRefusal";
import { formatLogLine, LOG_THRESHOLDS } from "./logFormat";

// Read off `createEnv` rather than imported: the package declaring the Standard Schema issue is a
// transitive dependency, and pnpm puts none of those on this module's resolution path.
type ValidationIssues = Parameters<NonNullable<Parameters<typeof createEnv>[0]["onValidationError"]>>[0];

// The class `fl_backend/app/core/config.py :: INTERNAL_API_KEY_CHARACTERS` pins: printable ASCII
// without the space, which `secrets.compare_digest` there reads (`docs/ops/spec.md :: I11`).
export const INTERNAL_API_KEY = z
  .string()
  .length(64)
  .regex(/^[\x21-\x7e]+$/, "printable ASCII only, with no space");

// Where Compose mounts a file secret, which is where a container finds it with nothing set.
const DEFAULT_SECRETS_DIR = "/run/secrets";

// One `KEY: "file",` a line, which `scripts/checks/check_compose_model.py :: frontend_schema_files`
// holds the compose files to, as it does `PRODUCTION_ONLY_REQUIRED` below.
/**
 * Each value read from a file rather than the environment, by the schema's key. One file name serves the
 * host, the container and development, so the database login carries this service's prefix: the backend
 * holds another.
 */
const SECRET_FILES = {
  MONGODB_URI: "frontend_mongodb_uri",
  AUTH_SECRET: "auth_secret",
  AUTH_RESEND_KEY: "auth_resend_key",
  RESEND_WEBHOOK_SECRET: "resend_webhook_secret",
  INTERNAL_API_KEY_BASE: "internal_api_key_base",
  INTERNAL_API_KEY_SYSTEM: "internal_api_key_system",
  INTERNAL_API_KEY_ADMIN: "internal_api_key_admin",
  TURNSTILE_SECRET_KEY: "turnstile_secret_key",
} as const;

type SecretKey = keyof typeof SECRET_FILES;

const isSecretKey = (name: string): name is SecretKey => Object.hasOwn(SECRET_FILES, name);

// Fatal, as the backend's read is: a lenient decode turns a byte that is not UTF-8 into U+FFFD and
// hands the schema a value nobody wrote.
const UTF8 = new TextDecoder("utf-8", { fatal: true });

/** An error's errno name where it has one, its class otherwise: the one part of a read's failure that quotes nothing. */
function failureName(error: unknown): string {
  if (error instanceof Error && "code" in error && typeof error.code === "string") return error.code;

  return error instanceof Error ? error.constructor.name : "unknown failure";
}

// Never exported: it hands back every secret's value, so a suite drives it through the boot alone.
/**
 * What the secrets directory holds for each key, and each read that failed as `<path> (<errno>)`. A file
 * that does not exist is left out rather than failed, so the schema decides whether it was required.
 */
function readSecretFiles(directory: string): { values: Partial<Record<SecretKey, string>>; unreadable: string[] } {
  const values: Partial<Record<SecretKey, string>> = {};

  // The directory's own shape first, as the backend names it: missing, it would otherwise read as
  // every file missing, naming each of them where one directory is at fault.
  try {
    if (!statSync(directory).isDirectory()) return { values, unreadable: [`${directory} (ENOTDIR)`] };
  } catch (error) {
    return { values, unreadable: [`${directory} (${failureName(error)})`] };
  }

  const unreadable: string[] = [];
  for (const [key, file] of Object.entries(SECRET_FILES) as [SecretKey, string][]) {
    const path = join(directory, file);
    try {
      // `trim()`, and the backend Python's `strip()`: the two part at U+FEFF, U+001C-U+001F and
      // U+0085, and a shared key's alphabet refuses each on the side keeping it, so the services
      // never hold two keys in silence (`docs/frontend/spec.md :: I504`).
      values[key] = UTF8.decode(readFileSync(path)).trim();
    } catch (error) {
      if (failureName(error) !== "ENOENT") unreadable.push(`${path} (${failureName(error)})`);
    }
  }

  return { values, unreadable };
}

/** One refusal's line, the sentence the backend prints for the same refusal and its log line's `error_code`. */
interface Refusal {
  sentence: string;
  error_code: string;
  field: "variables" | "files";
  names: readonly string[];
}

/** Each refusal's CRITICAL line, in the stream's own format, and then the one error that ends the boot. */
function refuse(refusals: readonly Refusal[]): never {
  // Read off the raw variable, which may itself be the invalid one, so anything but `json` falls
  // to the console shape.
  const format = process.env.LOG_FORMAT?.toLowerCase() === "json" ? "json" : "console";
  for (const { sentence, error_code, field, names } of refusals) {
    // The formatter rather than the logger: `logging.ts` imports this module, and importing it back
    // would close the cycle.
    process.stdout.write(formatLogLine(format, "CRITICAL", sentence, { error_code, [field]: names.join(", ") }) + "\n");
  }

  throw new BootRefusal(refusals.map(({ sentence, names }) => `${sentence}: ${names.join(", ")}`).join("; "));
}

export function refuseInvalidEnvironment(names: readonly string[]): never {
  const variables = names.filter((name) => !isSecretKey(name));
  // By the file's name, the one an operator goes and fixes.
  const files = names.filter(isSecretKey).map((name) => SECRET_FILES[name]);

  // The class the backend's boot refusals take, and its sentences (`docs/logging/error-codes.md` §3).
  refuse([
    ...(variables.length > 0
      ? [{ sentence: "Invalid environment variables", error_code: "FE-BOOT-001", field: "variables", names: variables } as const]
      : []),
    ...(files.length > 0
      ? [{ sentence: "Invalid secret files", error_code: "FE-BOOT-004", field: "files", names: files.sort() } as const]
      : []),
  ]);
}

function refuseUnreadableSecretFiles(unreadable: readonly string[]): never {
  refuse([{ sentence: "Unreadable secret files", error_code: "FE-BOOT-004", field: "files", names: unreadable }]);
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

// The deployments this repository defines -- `docker-compose.yml` and `docker-compose.local.yml`.
// A third member would name a stack nothing here deploys.
const APP_ENVIRONMENTS = ["production", "local"] as const;

// The credentials `production` demands and no other deployment holds, refused at boot on the
// production host alone. Files only: the deploy asks production for them by file, and for no
// variable beyond `REQUIRED_ENVIRONMENT_NAMES`.
const PRODUCTION_ONLY_REQUIRED = ["AUTH_RESEND_KEY", "RESEND_WEBHOOK_SECRET", "TURNSTILE_SECRET_KEY"] as const satisfies readonly SecretKey[];

// Mirrored from https://developers.cloudflare.com/turnstile/troubleshooting/testing/, read 2026-10-04,
// which moves without us: every published test key, site and secret alike, takes this shape.
const TURNSTILE_TEST_KEY = /^\dx0+[A-Z]{2}$/;

/**
 * The published secret that passes the token its paired site key mints and refuses every real one. Read
 * wherever no secret file was handed over, which production refuses, so no other deployment needs one.
 */
const TURNSTILE_TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

// Bound to names rather than written inside the call, so the preflight's sets can be read off the
// schema itself: a hand-kept copy of those names would be a second artefact to keep current.
const environment = {
  // Declared, never inferred: `AUTH_URL`'s refinement below records that the local stack sets a
  // production host too, and an origin test would call a staging box production. `mail.ts` sends on
  // this value alone.
  APP_ENV: z.enum(APP_ENVIRONMENTS),

  // The public origin reaches FastAPI on the liveness path alone, so an API_URL sharing
  // AUTH_URL's origin leaves the footer's probe green while Next's 404 answers every other
  // call (`docs/ops/spec.md :: I13`). Caught at boot: that shape reads as healthy.
  API_URL: z.url().refine((raw) => {
    const authUrl = process.env.AUTH_URL;
    return !authUrl || new URL(raw).origin !== new URL(authUrl).origin;
  }, "API_URL must reach the backend directly, not through the public origin AUTH_URL names"),
  API_VERSION: z.coerce.number().int(),

  // A stray http:// here ships a session cookie in plaintext: `fl_frontend/src/core/auth.ts` reads this
  // value's SCHEME and gives the cookie the `__Host-` name prefix and the `secure` attribute together
  // or neither (`docs/frontend/spec.md` §1.7).

  // Gated on the host, not NODE_ENV: the local stack sets it to production too.
  AUTH_URL: z.url().refine((raw) => {
    const { protocol, hostname } = new URL(raw);
    return protocol === "https:" || hostname === "localhost" || hostname === "127.0.0.1";
  }, "AUTH_URL must use https:// unless it points at localhost"),

  // A path, never the key: an environment value shows in `docker inspect`, and a mounted secret file
  // in neither that nor this schema's refusals. Defaulted to where the compose secret mounts.
  ACTOR_SIGNING_KEY_FILE: z.string().min(1).default("/run/secrets/fl_actor_signing_key"),

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

  // Public: the bot check's widget prints it into the page. No default, so a host's file leaving it out
  // is refused before the recreate rather than at the boot.
  TURNSTILE_SITE_KEY: z.string().min(1),
};

const fromFiles = {
  MONGODB_URI: z.string().regex(/^(mongodb(?:\+srv)?):\/\/.+/, "MongoDB URI must start with 'mongodb://' or 'mongodb+srv://'"),

  // The library's own floor, which it only warns below, so a short value signs every admin session
  // behind a deploy nothing turned red (`docs/frontend/spec.md :: I317`).
  AUTH_SECRET: z.string().min(32),
  // Optional here and demanded below under `production` alone: what keeps a send off another
  // deployment is `APP_ENV`, never this being absent, a development machine possibly holding a real
  // key. Never empty, the demand testing for absence alone.
  AUTH_RESEND_KEY: z.string().min(1).optional(),

  // Stricter than `svix`, which verifies with the prefix or without it: refusing at boot beats a 400
  // the provider retries for thirty-two hours before disabling the endpoint. Demanded of production
  // alone, the one deployment the provider sends its events to.
  RESEND_WEBHOOK_SECRET: z
    .string()
    .startsWith("whsec_", "the signing secret Resend shows on the webhook's detail page starts with whsec_")
    .optional(),

  INTERNAL_API_KEY_BASE: INTERNAL_API_KEY,
  INTERNAL_API_KEY_SYSTEM: INTERNAL_API_KEY,
  INTERNAL_API_KEY_ADMIN: INTERNAL_API_KEY,

  // Demanded of production alone, `TURNSTILE_TEST_SECRET_KEY` standing in everywhere else.
  TURNSTILE_SECRET_KEY: z.string().min(1).optional(),
} satisfies Record<SecretKey, z.ZodType>;

const client = {};

const skipValidation = process.env.SKIP_ENV_VALIDATION === "true";

// Read before the schema is, so a boot refusing an unreadable file names it rather than the
// values it left missing. A skipped validation refuses nothing: the builder holds none of these files.
const secrets = readSecretFiles(process.env.SECRETS_DIR ?? DEFAULT_SECRETS_DIR);
if (!skipValidation && secrets.unreadable.length > 0) refuseUnreadableSecretFiles(secrets.unreadable);

// One validation over the settings and the secrets together: the production demand reads `APP_ENV`
// beside the files, and a boot refusing both kinds prints both lines before it throws.
const validated = createEnv({
  server: { ...environment, ...fromFiles },
  client,

  skipValidation,

  onValidationError: (issues) => refuseInvalidEnvironment(failingVariableNames(issues)),

  // The package's own hook for a rule reading two variables at once, which a per-variable schema
  // cannot express; its issues reach `onValidationError` like any other.
  createFinalSchema: (shape) =>
    z.object(shape).superRefine((values, ctx) => {
      if (values.APP_ENV !== "production") return;

      for (const name of PRODUCTION_ONLY_REQUIRED) {
        // Carries a `path`, so the refusal names the file to go and write: `failingVariableNames`
        // reduces an issue without one to `<unknown>`.
        if (values[name] === undefined) ctx.addIssue({ code: "custom", path: [name], message: `${name} is required under APP_ENV=production` });
      }

      // A test key passes every visitor, so production on one would run with no bot check at all.
      for (const name of ["TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"] as const) {
        if (TURNSTILE_TEST_KEY.test(values[name] ?? "")) {
          ctx.addIssue({ code: "custom", path: [name], message: `${name} holds one of Cloudflare's test keys under APP_ENV=production` });
        }
      }
    }),

  runtimeEnv: {
    APP_ENV: process.env.APP_ENV,
    API_URL: process.env.API_URL,
    API_VERSION: process.env.API_VERSION,

    AUTH_URL: process.env.AUTH_URL,

    ACTOR_SIGNING_KEY_FILE: process.env.ACTOR_SIGNING_KEY_FILE,

    LOG_FORMAT: process.env.LOG_FORMAT,
    LOG_LEVEL: process.env.LOG_LEVEL,
    BEWERBUNG_SWEEP: process.env.BEWERBUNG_SWEEP,
    TURNSTILE_SITE_KEY: process.env.TURNSTILE_SITE_KEY,

    // Off the files alone: a variable of the same name, standing in for a missing file, would hand
    // a credential `docker inspect` prints to a boot that should refuse.
    MONGODB_URI: secrets.values.MONGODB_URI,
    AUTH_SECRET: secrets.values.AUTH_SECRET,
    AUTH_RESEND_KEY: secrets.values.AUTH_RESEND_KEY,
    RESEND_WEBHOOK_SECRET: secrets.values.RESEND_WEBHOOK_SECRET,
    INTERNAL_API_KEY_BASE: secrets.values.INTERNAL_API_KEY_BASE,
    INTERNAL_API_KEY_SYSTEM: secrets.values.INTERNAL_API_KEY_SYSTEM,
    INTERNAL_API_KEY_ADMIN: secrets.values.INTERNAL_API_KEY_ADMIN,
    TURNSTILE_SECRET_KEY: secrets.values.TURNSTILE_SECRET_KEY,
  },
});

type Settings = Readonly<Pick<typeof validated, keyof typeof environment>>;

// Off the validated object less the secrets rather than off `environment`'s keys: under a skipped
// validation that object is `runtimeEnv` itself, which `fl_frontend/scripts/check-environment-names.test.mjs`
// holds the emitted names to.
/**
 * The settings, and no secret: any server module may import this, so each secret is handed out by its
 * own reader below, which `fl_frontend/eslint.config.mjs :: SECRET_READERS` lets its owner alone import.
 */
export const frontend_config = Object.fromEntries(Object.entries(validated).filter(([name]) => !isSecretKey(name))) as Settings;

export const mongodbUri = (): string => validated.MONGODB_URI;
export const authSecret = (): string => validated.AUTH_SECRET;
export const authResendKey = (): string | undefined => validated.AUTH_RESEND_KEY;
export const resendWebhookSecret = (): string | undefined => validated.RESEND_WEBHOOK_SECRET;
export const internalApiKeyBase = (): string => validated.INTERNAL_API_KEY_BASE;
export const internalApiKeySystem = (): string => validated.INTERNAL_API_KEY_SYSTEM;
export const internalApiKeyAdmin = (): string => validated.INTERNAL_API_KEY_ADMIN;
export const turnstileSecretKey = (): string => validated.TURNSTILE_SECRET_KEY ?? TURNSTILE_TEST_SECRET_KEY;

/**
 * `scripts/ops/deploy.sh :: check_frontend_env_names` refuses a deploy whose environment file carries a name
 * outside this set: nothing in this schema reads one, so it reads as omitted and the shipped default
 * serves production.
 */
export const DECLARED_ENVIRONMENT_NAMES: readonly string[] = Object.keys(environment).sort();

// Asked of the schema rather than read off its shape: `.optional()` and `.default()` are two
// spellings of one answer, and Zod publishes no introspection that gives it.
const required = (declarations: Record<string, z.ZodType>): string[] =>
  Object.entries(declarations)
    .filter(([, declaration]) => !declaration.safeParse(undefined).success)
    .map(([name]) => name);

/**
 * The same preflight refuses a file that omits one of these. A name the file never declares reaches
 * `createEnv` as `undefined`, so the container is recreated and then refuses to boot behind an edge
 * already answering 502.
 */
export const REQUIRED_ENVIRONMENT_NAMES: readonly string[] = required(environment).sort();
