import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, describe, it } from "node:test";

import { documentsWrittenBy, documentsWrittenByAsync } from "./stdoutCapture.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { ADMIN_EMAIL_ALLOWLIST, DECLARED_ENVIRONMENT_NAMES, failingVariableNames, INTERNAL_API_KEY, refuseInvalidEnvironment } =
  await import("./config.ts");

const LENGTH = 64;
const pad = (head: string): string => head + "k".repeat(LENGTH - [...head].length);

const ORIGINAL_LOG_FORMAT = process.env.LOG_FORMAT;

afterEach(() => {
  if (ORIGINAL_LOG_FORMAT === undefined) delete process.env.LOG_FORMAT;
  else process.env.LOG_FORMAT = ORIGINAL_LOG_FORMAT;
});

describe("the schema the three internal API keys share", () => {
  it("takes a key of printable ASCII, the placeholder the runbook prints among them", () => {
    for (const key of [pad("a"), "x".repeat(LENGTH), pad("!~-_.+/=")]) {
      assert.equal(INTERNAL_API_KEY.safeParse(key).success, true, `refused ${String([...key].length)} printable characters`);
    }
  });

  it("refuses a key of the right length carrying one non-ASCII character", () => {
    // `secrets.compare_digest` on the backend raises rather than answering false for this key, so
    // the API would answer every internal request 500 instead of 401.
    assert.equal(INTERNAL_API_KEY.safeParse(pad("ü")).success, false);
  });

  it("refuses a key of 64 code points carrying one astral character", () => {
    // The case the length check alone already refuses HERE and accepts on the backend: this
    // `length` counts the surrogate pair twice and Python's counts it once.
    const astral = pad("\u{1F600}");

    assert.equal([...astral].length, LENGTH);
    assert.equal(astral.length, LENGTH + 1);
    assert.equal(INTERNAL_API_KEY.safeParse(astral).success, false);
  });

  it("refuses a key a space would let through a bearer header", () => {
    assert.equal(INTERNAL_API_KEY.safeParse(pad("a b")).success, false);
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
      assert.throws(() => refuseInvalidEnvironment(["AUTH_SECRET"]));
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
});

/** A complete environment the schema accepts, so a case below changes exactly the name it is about. */
const COMPLETE_ENV: Record<string, string> = {
  APP_ENV: "production",
  // A different origin from AUTH_URL, which the schema refuses them sharing.
  API_URL: "http://backend:8000",
  API_VERSION: "0",
  MONGODB_URI: "mongodb://mongo:27017/?directConnection=true",
  AUTH_URL: "https://frankfurtleague.de",
  AUTH_SECRET: "secret-probe",
  AUTH_RESEND_KEY: "resend-probe",
  RESEND_WEBHOOK_SECRET: "whsec_probe",
  INTERNAL_API_KEY_BASE: "b".repeat(LENGTH),
  INTERNAL_API_KEY_SYSTEM: "s".repeat(LENGTH),
  INTERNAL_API_KEY_ADMIN: "a".repeat(LENGTH),
  ALLOWED_ADMIN_EMAILS: "admin@frankfurtleague.de",
  // json, so the refusal below reaches `documentsWrittenByAsync` as a document rather than a
  // colourised line it passes through to the runner's own reporter.
  LOG_FORMAT: "json",
};

let probe = 0;

/** The real module's own boot, with the gate the `test` script stands down put back up. */
async function bootWith(overrides: Record<string, string | undefined>): Promise<Record<string, unknown>> {
  const before = { ...process.env };
  Object.assign(process.env, COMPLETE_ENV);
  delete process.env.SKIP_ENV_VALIDATION;
  for (const [name, value] of Object.entries(overrides)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  probe += 1;
  try {
    // A fresh module per case: one registry entry would answer every case with the first one's
    // environment.
    const booted = (await import(`./config.ts?probe=${String(probe)}`)) as { frontend_config: Record<string, unknown> };
    return booted.frontend_config;
  } finally {
    // One process holds one environment, so a case that left this where it put it would decide
    // every case after it.
    for (const name of Object.keys(process.env)) delete process.env[name];
    Object.assign(process.env, before);
  }
}

/** The names one refusal reported, off the document the gate wrote rather than off the thrown message. */
async function refusedNames(overrides: Record<string, string | undefined>): Promise<string> {
  const documents = await documentsWrittenByAsync(async () => {
    await assert.rejects(bootWith(overrides), /Invalid environment variables/);
  });

  assert.equal(documents.length, 1, `expected exactly one refusal document, saw ${documents.length}`);
  assert.equal(documents[0]?.error_code, "FE-BOOT-001");

  return String(documents[0]?.variables);
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
      assert.equal((await bootWith({ APP_ENV: value }))["APP_ENV"], value);
    }
  });
});

describe("the credential a deployment that mails must hold", () => {
  /* The whole of the fix: outside production the container holds no Resend key at all, so the send
     path has nothing to authorise with even where its own guard is gone. */
  it("boots with no key outside production", async () => {
    assert.equal((await bootWith({ APP_ENV: "local", AUTH_RESEND_KEY: undefined }))["AUTH_RESEND_KEY"], undefined);
  });

  /* Named rather than reported as an object-level refusal: `failingVariableNames` reduces an issue
     carrying no path to `<unknown>`, which names nothing an operator can go and set. */
  it("refuses production with no key, and names the key", async () => {
    assert.equal(await refusedNames({ APP_ENV: "production", AUTH_RESEND_KEY: undefined }), "AUTH_RESEND_KEY");
  });

  /* The name has to reach `scripts/ops/deploy.sh :: check_frontend_env_names`, which refuses a host
     file carrying a name the schema does not declare. */
  it("declares the deployment name, so a host may set it at all", async () => {
    assert.ok(DECLARED_ENVIRONMENT_NAMES.includes("APP_ENV"));
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

describe("the administrator allowlist", () => {
  const COMPOSED = "käthe@schule.de".normalize("NFC");
  const DECOMPOSED = COMPOSED.normalize("NFD");

  /* One refused entry fails the whole variable and `refuseInvalidEnvironment` throws, so an address
     the sign-in box takes has to pass here or the site does not boot at all. */
  it("takes every address the sign-in box takes", () => {
    for (const raw of [COMPOSED, "erika@käthe-schule.example", "a!b@schule.de"]) {
      assert.equal(ADMIN_EMAIL_ALLOWLIST.safeParse(raw).success, true, `refused ${raw}`);
    }
  });

  /* A separator nobody split on leaves one inert entry and every administrator locked out of a site
     that came up green, which is the failure the boot refusal exists to turn into a red deploy. */
  it("refuses an address no mailbox can be reached at, so a mis-split does not boot", () => {
    for (const raw of ["a@b.de;c@d.de", "erika@ab-.de", "erika@schule", ""]) {
      assert.equal(ADMIN_EMAIL_ALLOWLIST.safeParse(raw).success, false, `accepted ${raw}`);
    }
  });

  /* `@auth/core`'s `defaultNormalizer` NFKC-normalises before it lower-cases, and
     `fl_frontend/src/core/auth.ts :: isUserAdmin` compares its output against these entries with
     `includes`: the two spellings of an umlaut are different strings, so an entry left decomposed
     matches nothing anybody can type. */
  it("holds each entry in the form Auth.js hands the allowlist check", () => {
    assert.notEqual(COMPOSED, DECOMPOSED);

    assert.deepEqual(ADMIN_EMAIL_ALLOWLIST.safeParse(` ${COMPOSED.toUpperCase()} , ${DECOMPOSED} `).data, [COMPOSED, COMPOSED]);
  });
});
