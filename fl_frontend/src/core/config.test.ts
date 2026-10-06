import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, afterEach, describe, it } from "node:test";

import { isAPIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins/email-otp";

import { asSignInIdentifier, isSignInLibraryAddress } from "./emailAddress.ts";
import { registerDoubles } from "./exportingModule.ts";
import { documentsWrittenBy, documentsWrittenByAsync } from "./stdoutCapture.ts";

import type * as ConfigModule from "./config.ts";

registerDoubles();

const { DECLARED_ENVIRONMENT_NAMES, failingVariableNames, INTERNAL_API_KEY, refuseInvalidEnvironment, REQUIRED_ENVIRONMENT_NAMES } =
  await import("./config.ts");

const LENGTH = 64;
const pad = (head: string): string => head + "k".repeat(LENGTH - [...head].length);

/* Built from a sentence no reader could mistake for a real value: the schema judges the LENGTH, so
   a case either side of the floor needs nothing that reads like a credential. */
const artificialSecret = (length: number): string => "fabricated-not-a-credential".padEnd(length, "x").slice(0, length);

/** The floor the sign-in library warns below, which the two cases for it sit either side of. */
const SIGNING_FLOOR = 32;

const ORIGINAL_LOG_FORMAT = process.env.LOG_FORMAT;

afterEach(() => {
  if (ORIGINAL_LOG_FORMAT === undefined) delete process.env.LOG_FORMAT;
  else process.env.LOG_FORMAT = ORIGINAL_LOG_FORMAT;
});

/** Every case's own secrets directory lives under this one, removed after the run. */
const SECRETS_ROOT = mkdtempSync(path.join(tmpdir(), "fl-config-secrets-"));
after(() => rmSync(SECRETS_ROOT, { recursive: true, force: true }));

describe("the schema the three internal API keys share", () => {
  it("takes a key of every class character, the three generators' alphabets among them", () => {
    // `openssl rand -hex`, base64 with its padding, and `secrets.token_urlsafe`, then punctuation
    // reaching both ends of the range, `!` and `~`.
    for (const key of [pad("0123456789abcdef"), pad("AZaz09+/=="), pad("-_"), pad("!%&(["), pad("]^_a{|}~")]) {
      assert.equal(INTERNAL_API_KEY.safeParse(key).success, true, `refused ${String([...key].length)} class characters`);
    }
  });

  /* A key is read from its file alone, which no env-file reader parses, so the class need not refuse
     their syntax. */
  it("takes a key carrying a character Compose, python-dotenv, @next/env or Node reads as syntax", () => {
    for (const syntax of ['"', "#", "$", "'", "\\", "`"]) {
      assert.equal(INTERNAL_API_KEY.safeParse(pad(syntax)).success, true, `refused ${syntax}`);
    }
  });

  it("refuses a key of the right length carrying one non-ASCII character", () => {
    // `secrets.compare_digest` on the backend raises rather than answering false for this key, so
    // the API would answer every internal request 500 instead of 401.
    assert.equal(INTERNAL_API_KEY.safeParse(pad("ü")).success, false);
  });

  it("refuses a key a space would let through a bearer header", () => {
    assert.equal(INTERNAL_API_KEY.safeParse(pad("a b")).success, false);
  });

  // The class's upper edge, past which a header carries no character as written.
  it("refuses a key carrying DEL", () => {
    assert.equal(INTERNAL_API_KEY.safeParse(pad("a\x7f")).success, false);
  });

  it("refuses any other length", () => {
    for (const length of [LENGTH - 1, LENGTH + 1]) {
      assert.equal(INTERNAL_API_KEY.safeParse("k".repeat(length)).success, false, `accepted ${String(length)} characters`);
    }
  });
});

describe("the environment gate's refusal", () => {
  it("writes one CRITICAL document carrying the boot code and the failing names", () => {
    process.env.LOG_FORMAT = "json";

    const documents = documentsWrittenBy(() => {
      assert.throws(() => refuseInvalidEnvironment(["AUTH_URL", "LOG_LEVEL"]), /Invalid environment variables: AUTH_URL, LOG_LEVEL/);
    });

    assert.equal(documents.length, 1);
    assert.equal(documents[0]?.level, "CRITICAL");
    assert.equal(documents[0]?.error_code, "FE-BOOT-001");
    assert.equal(documents[0]?.variables, "AUTH_URL, LOG_LEVEL");
  });

  // The one value the line may never carry is a rejected one: the names are what identifies the
  // refusal, and a value beside them would reach a container log
  // (`docs/logging/spec.md :: L9`).
  it("names the variables and carries no value submitted for one", () => {
    process.env.LOG_FORMAT = "json";

    const documents = documentsWrittenBy(() => {
      assert.throws(() => refuseInvalidEnvironment(["LOG_LEVEL"]));
    });

    assert.deepEqual(Object.keys(documents[0] ?? {}), [
      "timestamp",
      "level",
      "service",
      "trace_id",
      "span_id",
      "message",
      "error_code",
      "variables",
    ]);
  });

  /* The file is what an operator goes and fixes, and the backend's refusal names the same file for
     the same value, so one hint in the deploy covers both. */
  it("names a value read from a file by the file, under the secret files' own code, beside any variable", () => {
    process.env.LOG_FORMAT = "json";

    const documents = documentsWrittenBy(() => {
      assert.throws(
        () => refuseInvalidEnvironment(["AUTH_SECRET", "AUTH_URL", "MONGODB_URI"]),
        /^Error: Invalid environment variables: AUTH_URL; Invalid secret files: auth_secret, frontend_mongodb_uri$/,
      );
    });

    assert.deepEqual(
      documents.map(({ error_code, variables, files }) => ({ error_code, variables, files })),
      [
        { error_code: "FE-BOOT-001", variables: "AUTH_URL", files: undefined },
        { error_code: "FE-BOOT-004", variables: undefined, files: "auth_secret, frontend_mongodb_uri" },
      ],
    );
  });
});

/** A complete environment the schema accepts, so a case below changes exactly the name it is about. */
const COMPLETE_ENV: Record<string, string> = {
  APP_ENV: "production",
  // A different origin from AUTH_URL, which the schema refuses them sharing.
  API_URL: "http://backend:8000",
  API_VERSION: "0",
  AUTH_URL: "https://frankfurtleague.de",
  // json, so the refusal below reaches `documentsWrittenByAsync` as a document rather than a
  // colourised line it passes through to the runner's own reporter.
  LOG_FORMAT: "json",
  // Of no published test key's shape, which production refuses.
  TURNSTILE_SITE_KEY: "fabricated-site-key",
};

/** Every secret file a production frontend is handed, by the file's own name, each holding a value the schema accepts. */
const COMPLETE_FILES: Record<string, string> = {
  frontend_mongodb_uri: "mongodb://mongo:27017/?directConnection=true",
  auth_secret: artificialSecret(SIGNING_FLOOR),
  auth_resend_key: "resend-probe",
  resend_webhook_secret: "whsec_probe",
  internal_api_key_base: "b".repeat(LENGTH),
  internal_api_key_system: "s".repeat(LENGTH),
  internal_api_key_admin: "a".repeat(LENGTH),
  turnstile_secret_key: "fabricated-turnstile-secret",
};

/** A file's place taken by a directory. */
const A_DIRECTORY = Symbol("a directory");

type SecretFiles = Record<string, string | Uint8Array | typeof A_DIRECTORY | undefined>;

/** A secrets directory of the case's own, holding `COMPLETE_FILES` with `files` over them; a file mapped to `undefined` is left out. */
function aSecretsDirectory(files: SecretFiles = {}): string {
  const directory = mkdtempSync(path.join(SECRETS_ROOT, "case-"));
  for (const [name, content] of Object.entries({ ...COMPLETE_FILES, ...files })) {
    if (content === A_DIRECTORY) mkdirSync(path.join(directory, name));
    else if (content !== undefined) writeFileSync(path.join(directory, name), content);
  }

  return directory;
}

let probe = 0;

/** The real module's own boot, with the gate the `test:base` script stands down put back up. */
async function bootWith(overrides: Record<string, string | undefined>, files: SecretFiles = {}): Promise<typeof ConfigModule> {
  const before = { ...process.env };
  Object.assign(process.env, COMPLETE_ENV, { SECRETS_DIR: aSecretsDirectory(files) });
  delete process.env.SKIP_ENV_VALIDATION;
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  probe += 1;
  try {
    // A fresh module per case: one registry entry would answer every case with the first one's
    // environment.
    return (await import(`./config.ts?probe=${String(probe)}`)) as typeof ConfigModule;
  } finally {
    // One process holds one environment, so a case that left this where it put it would decide
    // every case after it.
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, before);
  }
}

/** The one refusal a boot wrote, off the document rather than off the thrown message: its code and what it named. */
async function refusedWith(overrides: Record<string, string | undefined>, files: SecretFiles = {}): Promise<{ code: unknown; named: string }> {
  const documents = await documentsWrittenByAsync(async () => {
    await assert.rejects(bootWith(overrides, files), /Invalid environment variables|Invalid secret files|Unreadable secret files/);
  });

  assert.equal(documents.length, 1, `expected exactly one refusal document, saw ${documents.length}`);

  return { code: documents[0]?.error_code, named: String(documents[0]?.variables ?? documents[0]?.files) };
}

/** The variables one refusal named, which the environment's own code carries. */
async function refusedNames(overrides: Record<string, string | undefined>): Promise<string> {
  const { code, named } = await refusedWith(overrides);
  assert.equal(code, "FE-BOOT-001");

  return named;
}

/** The files one refusal named, which the secret files' own code carries. */
async function refusedFiles(files: SecretFiles, overrides: Record<string, string | undefined> = {}): Promise<string> {
  const { code, named } = await refusedWith(overrides, files);
  assert.equal(code, "FE-BOOT-004");

  return named;
}

describe("the deployment the environment declares", () => {
  /* Declared rather than inferred, so the value nothing sets is a refusal an operator reads at boot
     rather than a stack that mails because its hostname looked like production's. */
  it("refuses a boot that names no deployment, and says which variable to set", async () => {
    assert.equal(await refusedNames({ APP_ENV: undefined }), "APP_ENV");
  });

  it("refuses a misspelling rather than reading it as one deployment or the other", async () => {
    for (const value of ["Production", "prod", "PRODUCTION", ""]) {
      assert.equal(await refusedNames({ APP_ENV: value }), "APP_ENV", `accepted ${value}`);
    }
  });

  it("boots each deployment the repository defines", async () => {
    for (const value of ["production", "local"]) {
      assert.equal((await bootWith({ APP_ENV: value })).frontend_config.APP_ENV, value);
    }
  });
});

describe("the credential a deployment that mails must hold", () => {
  /* The whole of the fix: outside production the container holds no Resend key at all, so the send
     path has nothing to authorise with even where its own guard is gone. */
  it("boots with no key outside production", async () => {
    assert.equal((await bootWith({ APP_ENV: "local" }, { auth_resend_key: undefined })).authResendKey(), undefined);
  });

  /* Named rather than reported as an object-level refusal: `failingVariableNames` reduces an issue
     carrying no path to `<unknown>`, which names nothing an operator can go and set. */
  it("refuses production with no key, and names its file", async () => {
    assert.equal(await refusedFiles({ auth_resend_key: undefined }), "auth_resend_key");
  });

  /* The demand tests for absence alone, so an empty file would otherwise pass it and fail at the
     first send instead of the boot. */
  it("refuses production an empty key, or one holding nothing but whitespace", async () => {
    for (const content of ["", " \r\n"]) {
      assert.equal(await refusedFiles({ auth_resend_key: content }), "auth_resend_key", `accepted ${JSON.stringify(content)}`);
    }
  });

  /* The name has to reach `scripts/ops/deploy.sh :: check_frontend_env_names`, which refuses a host
     file carrying a name the schema does not declare. */
  it("declares the deployment name, so a host may set it at all", async () => {
    assert.ok(DECLARED_ENVIRONMENT_NAMES.includes("APP_ENV"));
  });
});

describe("the key a deployment the provider sends its events to must hold", () => {
  /* The provider posts delivery events to production alone, so a machine off it is handed no key
     and holds no stand-in of the key's shape either. */
  it("boots with no webhook key outside production", async () => {
    assert.equal((await bootWith({ APP_ENV: "local" }, { resend_webhook_secret: undefined })).resendWebhookSecret(), undefined);
  });

  it("refuses production with no webhook key, and names its file", async () => {
    assert.equal(await refusedFiles({ resend_webhook_secret: undefined }), "resend_webhook_secret");
  });

  it("refuses a key without the provider's prefix wherever one is held", async () => {
    assert.equal(await refusedFiles({ resend_webhook_secret: "probe" }, { APP_ENV: "local" }), "resend_webhook_secret");
  });

  /* A file holding nothing is a key nobody wrote, never a file left out: refused on either deployment. */
  it("refuses a blank key file wherever one is held, and names its file", async () => {
    for (const APP_ENV of ["production", "local"]) {
      assert.equal(await refusedFiles({ resend_webhook_secret: " \n" }, { APP_ENV }), "resend_webhook_secret", `accepted under ${APP_ENV}`);
    }
  });
});

describe("the bot check's two keys", () => {
  /* Cloudflare's published test keys, from https://developers.cloudflare.com/turnstile/troubleshooting/testing/,
     read 2026-10-04: each passes every visitor, so production on one would run with no check at all. */
  const TEST_SITE_KEYS = [
    "1x00000000000000000000AA",
    "2x00000000000000000000AB",
    "1x00000000000000000000BB",
    "2x00000000000000000000BB",
    "3x00000000000000000000FF",
  ];
  const TEST_SECRETS = ["1x0000000000000000000000000000000AA", "2x0000000000000000000000000000000AA", "3x0000000000000000000000000000000AA"];

  it("refuses production a published test site key, naming the variable", async () => {
    for (const key of TEST_SITE_KEYS) assert.equal(await refusedNames({ TURNSTILE_SITE_KEY: key }), "TURNSTILE_SITE_KEY", `accepted ${key}`);
  });

  it("refuses production a published test secret, naming its file", async () => {
    for (const key of TEST_SECRETS) assert.equal(await refusedFiles({ turnstile_secret_key: key }), "turnstile_secret_key", `accepted ${key}`);
  });

  it("boots any other deployment on the test keys", async () => {
    const booted = await bootWith({ APP_ENV: "local", TURNSTILE_SITE_KEY: TEST_SITE_KEYS[0] }, { turnstile_secret_key: TEST_SECRETS[0] });

    assert.equal(booted.frontend_config.TURNSTILE_SITE_KEY, TEST_SITE_KEYS[0]);
  });

  /* The local stack and a development machine are handed no secret: what verifies there is the published
     one, which passes the test site key's token alone. */
  it("verifies with the published passing secret where no deployment but production hands one over", async () => {
    assert.equal((await bootWith({ APP_ENV: "local" }, { turnstile_secret_key: undefined })).turnstileSecretKey(), TEST_SECRETS[0]);
  });

  it("refuses production with no secret, and names its file", async () => {
    assert.equal(await refusedFiles({ turnstile_secret_key: undefined }), "turnstile_secret_key");
  });
});

describe("the names the preflight demands a host's file carry", () => {
  /* Derived by booting rather than read off the schema, which is the emitter's own route: two
     listings that must agree (`docs/_standard/standard.md :: PRE-4`). */
  it("names every variable no deployment may leave unset, and no other", async () => {
    const refused: string[] = [];

    await documentsWrittenByAsync(async () => {
      for (const name of DECLARED_ENVIRONMENT_NAMES) {
        // `local` rather than the complete environment's `production`: under production the schema
        // demands one file more, which is a case below rather than this one.
        await bootWith({ APP_ENV: "local", [name]: undefined }).catch(() => refused.push(name));
      }
    });

    assert.deepEqual(refused, [...REQUIRED_ENVIRONMENT_NAMES]);
  });

  /* Named, where the case above reads both of its listings off the schema: a required variable made
     optional moves both together, and only a case naming it refuses the change. */
  it("refuses a boot handed no backend address, naming the variable", async () => {
    assert.equal(await refusedNames({ API_URL: undefined }), "API_URL");
  });

  /* The deploy asks production for its own files and for no variable beyond the set above, so a
     variable demanded on a VALUE of `APP_ENV` would pass the preflight and refuse the boot. */
  it("demands no variable of production beyond what every deployment is held to", async () => {
    const refused: string[] = [];

    await documentsWrittenByAsync(async () => {
      for (const name of DECLARED_ENVIRONMENT_NAMES) {
        if (REQUIRED_ENVIRONMENT_NAMES.includes(name)) continue;
        await bootWith({ APP_ENV: "production", [name]: undefined }).catch(() => refused.push(name));
      }
    });

    assert.deepEqual(refused, []);
  });
});

type SecretReader =
  | "mongodbUri"
  | "authSecret"
  | "authResendKey"
  | "resendWebhookSecret"
  | "internalApiKeyBase"
  | "internalApiKeySystem"
  | "internalApiKeyAdmin"
  | "turnstileSecretKey";

/**
 * Each secret's key, the variable a host's file held before the secret was a file, then its file, a value
 * the schema takes, so a boot reading the variable is not mistaken for one refusing it, and its reader.
 */
const LEFT_BEHIND: readonly (readonly [variable: string, file: string, value: string, reader: SecretReader])[] = [
  ["MONGODB_URI", "frontend_mongodb_uri", "mongodb://left-behind:27017/?directConnection=true", "mongodbUri"],
  ["AUTH_SECRET", "auth_secret", artificialSecret(SIGNING_FLOOR + 1), "authSecret"],
  ["AUTH_RESEND_KEY", "auth_resend_key", "resend-left-behind", "authResendKey"],
  ["RESEND_WEBHOOK_SECRET", "resend_webhook_secret", "whsec_left_behind", "resendWebhookSecret"],
  ["INTERNAL_API_KEY_BASE", "internal_api_key_base", "l".repeat(LENGTH), "internalApiKeyBase"],
  ["INTERNAL_API_KEY_SYSTEM", "internal_api_key_system", "m".repeat(LENGTH), "internalApiKeySystem"],
  ["INTERNAL_API_KEY_ADMIN", "internal_api_key_admin", "n".repeat(LENGTH), "internalApiKeyAdmin"],
  ["TURNSTILE_SECRET_KEY", "turnstile_secret_key", "turnstile-left-behind", "turnstileSecretKey"],
];

describe("the secret files the frontend reads", () => {
  /* Paired through the refusal, which names a key's file by the schema's own map: a variable here the
     schema does not read as that file would leave each case below passing over a name nothing reads. */
  it("names every secret file once, by the key the schema reads it as", () => {
    assert.deepEqual(LEFT_BEHIND.map(([, file]) => file).sort(), Object.keys(COMPLETE_FILES).sort());

    process.env.LOG_FORMAT = "json";
    for (const [variable, file] of LEFT_BEHIND) {
      const documents = documentsWrittenBy(() => {
        assert.throws(() => refuseInvalidEnvironment([variable]));
      });

      assert.equal(documents[0]?.files, file, variable);
    }
  });

  /* Declared, a credential's line in a host's file would pass the deploy's name check and reach the
     container's environment, which `docker inspect` prints. */
  it("declares none of the variables a secret is read from instead, nor the administrator list the grants replaced", () => {
    for (const name of [...LEFT_BEHIND.map(([variable]) => variable), "ALLOWED_ADMIN_EMAILS"]) {
      assert.ok(!DECLARED_ENVIRONMENT_NAMES.includes(name), `${name} is declared`);
    }
  });

  /* The variable a release before this one read, left behind in a host's file: standing in for a
     missing file it would hand a credential `docker inspect` prints to a boot that should refuse. */
  for (const [variable, file, leftBehind, reader] of LEFT_BEHIND) {
    it(`takes no value from ${variable}, beside ${file} or in place of it`, async () => {
      assert.equal((await bootWith({ [variable]: leftBehind }))[reader](), COMPLETE_FILES[file]);
      // Refused rather than left unset: `COMPLETE_ENV` boots production, which requires every file.
      assert.equal(await refusedFiles({ [file]: undefined }, { [variable]: leftBehind }), file);
    });
  }

  /* Any server module may import the settings, so a secret among them would reach every module
     rather than the one `fl_frontend/eslint.config.mjs :: SECRET_READERS` lets import its reader. */
  it("hands each secret out through its reader alone, never among the settings", async () => {
    const booted = await bootWith({});

    assert.deepEqual(Object.keys(booted.frontend_config).sort(), DECLARED_ENVIRONMENT_NAMES);
    for (const [, file, , reader] of LEFT_BEHIND) assert.equal(booted[reader](), COMPLETE_FILES[file], reader);
  });

  it("reads a value without the line break an editor leaves after it", async () => {
    assert.equal((await bootWith({}, { resend_webhook_secret: "whsec_probe\r\n" })).resendWebhookSecret(), "whsec_probe");
  });

  /* `trim()` parts from the backend's Python `strip()` at U+FEFF, U+001C-U+001F and U+0085. A shared
     key keeping one here is refused, never read as a key the backend lacks; the backend's alphabet
     refuses the U+FEFF it keeps. */
  it("refuses a shared key the two languages strip apart, naming its file", async () => {
    assert.equal(await refusedFiles({ internal_api_key_base: `${"b".repeat(LENGTH)}\u0085` }), "internal_api_key_base");
    assert.equal(await refusedFiles({ internal_api_key_base: `\u001c${"b".repeat(LENGTH)}` }), "internal_api_key_base");
  });

  /* What Docker leaves where a bind mount's source file was missing. */
  it("refuses a directory standing at a file's path, naming the path and the errno", async () => {
    const { named } = await refusedWith({}, { auth_secret: A_DIRECTORY });

    assert.match(named, /[\\/]auth_secret \(EISDIR\)$/);
  });

  /* A lenient decode would hand the schema a value with U+FFFD in it that nobody wrote. The marker
     is the file's content, which the line may never carry. */
  it("refuses a file that is not UTF-8, naming the path and never the content", async () => {
    const marker = "fabricated-marker-never-printed";
    const documents = await documentsWrittenByAsync(async () => {
      await assert.rejects(
        bootWith({}, { auth_secret: Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(marker)]) }),
        /Unreadable secret files/,
      );
    });

    assert.equal(documents[0]?.error_code, "FE-BOOT-004");
    assert.match(String(documents[0]?.files), /[\\/]auth_secret \(ERR_ENCODING_INVALID_ENCODED_DATA\)$/);
    assert.ok(!JSON.stringify(documents).includes(marker), "the refusal carried the file's content");
  });

  it("refuses a directory that is not there, naming it rather than every file inside it", async () => {
    const missing = path.join(SECRETS_ROOT, "nowhere");

    assert.equal(await refusedFiles({}, { SECRETS_DIR: missing }), `${missing} (ENOENT)`);
  });
});

describe("the names a failed validation is reduced to", () => {
  it("keeps one entry per variable, sorted", () => {
    const issues = [
      { message: "invalid", path: ["LOG_LEVEL"] },
      { message: "invalid", path: ["AUTH_URL"] },
      { message: "invalid", path: ["LOG_LEVEL"] },
    ];

    assert.deepEqual(failingVariableNames(issues), ["AUTH_URL", "LOG_LEVEL"]);
  });

  // A refusal of the whole object carries no path, and dropping such an issue would leave the
  // refusal line naming nothing at all.
  it("stands `<unknown>` in for an issue naming no variable", () => {
    assert.deepEqual(failingVariableNames([{ message: "the object was refused" }]), ["<unknown>"]);
  });

  /* The other shape Standard Schema admits for a segment, which a validator may emit for the same
     variable the plain key names: read as a whole it renders `[object Object]`. */
  it("reads a variable wrapped as a path segment object", () => {
    assert.deepEqual(failingVariableNames([{ message: "invalid", path: [{ key: "AUTH_SECRET" }] }]), ["AUTH_SECRET"]);
  });
});

/* One row per clause of the two installed regexes, each keyed by the clause it drives: a clause with
   no row here is drift the agreement case cannot see, and a row nothing drives is a row to delete. */
const ADDRESS_TABLE: [clause: string, address: string][] = [
  ["a plain address", "vorstand@schule.de"],
  ["a dot inside the local part", "vor.stand@schule.de"],
  ["a plus tag", "vorstand+admin@schule.de"],
  ["an underscore in the local part", "vor_stand@schule.de"],
  ["an apostrophe in the local part", "o'neill@schule.de"],
  ["an upper-case spelling", "VORSTAND@Schule.de"],
  ["a punycoded domain", "vorstand@xn--mnchen-3ya.de"],
  ["a host label ending in a hyphen", "erika@ab-.de"],
  ["a local part opening on a dot", ".vorstand@schule.de"],
  ["a doubled dot in the local part", "vor..stand@schule.de"],
  ["a local part closing on a dot", "vorstand.@schule.de"],
  ["a local part closing on an apostrophe", "vorstand'@schule.de"],
  ["an atext character outside the library's class", "a!b@schule.de"],
  ["a non-ASCII local part", "jörg@schule.de"],
  ["a quoted local part", '"vor stand"@schule.de'],
  ["a host label opening on a hyphen", "vorstand@-schule.de"],
  ["a non-ASCII domain", "vorstand@münchen.de"],
  ["a host carrying no dot", "erika@schule"],
  ["a single-letter top-level domain", "vorstand@schule.a"],
  ["a digit in the top-level domain", "vorstand@schule.d1"],
  ["a doubled dot in the host", "vorstand@schule..de"],
  ["nothing at all", ""],
];

describe("the sign-in library's own rule", () => {
  /* The send endpoint's own check, driven rather than copied: what it refuses is what a request for a
     code meets. It checks inside its handler, ahead of its first store call, which a store throwing
     on any use marks. */
  const sendCode = emailOTP({ sendVerificationOTP: async () => undefined }).endpoints.sendVerificationOTP;

  class ReachedTheStore extends Error {}
  const refusingStore = new Proxy(
    {},
    {
      get: () => () => {
        throw new ReachedTheStore();
      },
    },
  );

  async function libraryTakes(folded: string): Promise<boolean> {
    try {
      await sendCode({ body: { email: folded, type: "sign-in" }, context: { internalAdapter: refusingStore } });
    } catch (answered) {
      if (answered instanceof ReachedTheStore) return true;
      if (isAPIError(answered) && answered.body?.code === "INVALID_EMAIL") return false;
      throw answered;
    }
    assert.fail("the endpoint reached neither its refusal nor the store");
  }

  /* An agreement over a table of refusals alone agrees on everything, and a table short of the
     clauses agrees on the ones it left out. */
  it("compares a table that covers both regexes and carries an answer of each kind", async () => {
    const answers = await Promise.all(ADDRESS_TABLE.map(([, address]) => libraryTakes(asSignInIdentifier(address))));

    assert.ok(ADDRESS_TABLE.length >= 12, `the table holds ${String(ADDRESS_TABLE.length)} rows`);
    assert.ok(answers.includes(true), "the library takes nothing in the table");
    assert.ok(answers.includes(false), "the library takes everything in the table");
  });

  /* The library's check is its own, so a release moving it is a lock-out that nothing else here
     would catch. */
  it("answers each address the way the grant's own predicate does", async () => {
    for (const [clause, address] of ADDRESS_TABLE) {
      const folded = asSignInIdentifier(address);

      assert.equal(isSignInLibraryAddress(folded), await libraryTakes(folded), `disagreed on ${clause}: ${address}`);
    }
  });
});

describe("the value an admin session is signed with", () => {
  it("refuses a value one character under the sign-in library's floor, and names its file", async () => {
    assert.equal(await refusedFiles({ auth_secret: artificialSecret(SIGNING_FLOOR - 1) }), "auth_secret");
  });

  it("boots at the floor", async () => {
    const value = artificialSecret(SIGNING_FLOOR);

    assert.equal((await bootWith({}, { auth_secret: value })).authSecret(), value);
  });

  /* The library only warns below the floor, so the refusal here is the only thing standing between a
     short value and every admin session signed with it. */
  it("carries no part of the refused value into the line an operator reads", async () => {
    const refused = artificialSecret(SIGNING_FLOOR - 1);
    const documents = await documentsWrittenByAsync(async () => {
      await assert.rejects(bootWith({}, { auth_secret: refused }), /Invalid secret files/);
    });

    assert.equal(documents[0]?.files, "auth_secret");
    for (const document of documents) {
      const written = JSON.stringify(document);

      for (const fragment of [refused, refused.slice(0, 12), refused.slice(-12)]) {
        assert.equal(written.includes(fragment), false, "a refusal line carried part of the value");
      }
    }
  });
});
