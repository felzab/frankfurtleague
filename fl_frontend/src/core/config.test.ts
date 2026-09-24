import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, describe, it } from "node:test";

import { magicLink } from "better-auth/plugins/magic-link";

import { asSignInIdentifier, isDeliverableAddress, isSignInLibraryAddress, KONTAKT_EMAIL_MAX_LENGTH } from "./emailAddress.ts";
import { documentsWrittenBy, documentsWrittenByAsync } from "./stdoutCapture.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const {
  ADMIN_EMAIL_ALLOWLIST,
  DECLARED_ENVIRONMENT_NAMES,
  failingVariableNames,
  INTERNAL_API_KEY,
  PRODUCTION_REQUIRED_ENVIRONMENT_NAMES,
  refuseInvalidEnvironment,
  REQUIRED_ENVIRONMENT_NAMES,
} = await import("./config.ts");

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
  AUTH_SECRET: artificialSecret(SIGNING_FLOOR),
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

describe("the names the preflight demands a host's file carry", () => {
  /* Derived by booting rather than read off the schema, which is the emitter's own route: two
     listings that must agree (`docs/_standard/standard.md :: PRE-4`). */
  it("names every variable no deployment may leave unset, and no other", async () => {
    const refused: string[] = [];

    await documentsWrittenByAsync(async () => {
      for (const name of DECLARED_ENVIRONMENT_NAMES) {
        // `local` rather than the complete environment's `production`: under production the schema
        // demands one name more, which is the case below rather than this one.
        await bootWith({ APP_ENV: "local", [name]: undefined }).catch(() => refused.push(name));
      }
    });

    assert.deepEqual(refused, [...REQUIRED_ENVIRONMENT_NAMES]);
  });

  /* Derived the same way, and the half the set above cannot hold: these refuse on a VALUE of
     `APP_ENV`, and the deploy passes `--production` so that the reader demands them anyway. */
  it("names every variable production alone may not leave unset, and no other", async () => {
    const refused: string[] = [];

    await documentsWrittenByAsync(async () => {
      for (const name of DECLARED_ENVIRONMENT_NAMES) {
        if (REQUIRED_ENVIRONMENT_NAMES.includes(name)) continue;
        await bootWith({ APP_ENV: "production", [name]: undefined }).catch(() => refused.push(name));
      }
    });

    assert.deepEqual(refused, [...PRODUCTION_REQUIRED_ENVIRONMENT_NAMES]);
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

describe("the administrator allowlist", () => {
  /* Capitals and an umlaut domain, which the fold makes the lower-case punycode the sign-in library
     takes: an entry the fold leaves above ASCII is one the library refuses, and the case below would
     then be proving a refusal instead. */
  const UNFOLDED = "Vorstand@MÜNCHEN.de";
  const FOLDED = "vorstand@xn--mnchen-3ya.de";

  /* One refused entry fails the whole variable and `refuseInvalidEnvironment` throws, so an address
     a link can be mailed to has to pass here or the site does not boot at all. */
  it("takes an address both the sign-in box and the sign-in library accept", () => {
    for (const raw of [
      "vorstand@schule.de",
      "vorstand+admin@schule.de",
      "VORSTAND@Schule.de",
      "vorstand@xn--mnchen-3ya.de",
      "vorstand@münchen.de",
    ]) {
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

  /* The second assertion is what makes each row drive THIS rule: an address the API's own rule
     refuses would be refused here whatever the sign-in library says. */
  it("refuses an address the sign-in library will not take, whatever the API's own rule says", () => {
    for (const raw of ["a!b@schule.de", "vorstand@schule.a"]) {
      assert.equal(ADMIN_EMAIL_ALLOWLIST.safeParse(raw).success, false, `accepted ${raw}`);
      assert.equal(isDeliverableAddress(asSignInIdentifier(raw)), true, `${raw} drives nothing: the API's rule refuses it too`);
    }
  });

  /* An entry stored in any other form matches nothing anybody can type
     (`fl_frontend/src/core/emailAddress.ts :: asSignInIdentifier`). */
  it("holds each entry in the form the allowlist check folds an address into", () => {
    assert.notEqual(UNFOLDED, FOLDED);

    assert.deepEqual(ADMIN_EMAIL_ALLOWLIST.safeParse(` ${UNFOLDED} , ${FOLDED.toUpperCase()} `).data, [FOLDED, FOLDED]);
  });

  /* An entry over the sign-in box's own ceiling boots and then cannot be typed at the box
     (`fl_frontend/src/shared/schemas.ts :: KontaktEmailSchema`), which is the same lock-out from the
     other end. */
  it("refuses an entry longer than the sign-in box will take", async () => {
    const ofLength = (length: number): string => `${"a".repeat(length - "@schule.de".length)}@schule.de`;

    assert.equal(ADMIN_EMAIL_ALLOWLIST.safeParse(ofLength(KONTAKT_EMAIL_MAX_LENGTH)).success, true);
    assert.equal(await refusedNames({ ALLOWED_ADMIN_EMAILS: ofLength(KONTAKT_EMAIL_MAX_LENGTH + 1) }), "ALLOWED_ADMIN_EMAILS");
  });

  /* The refusal an operator reads has to send them to a variable, and the one value it may never
     carry is the entry that failed (`docs/logging/spec.md :: L9`). */
  it("names the variable for a refused entry, and carries no part of the address", async () => {
    const refused = "jörg@schule.de";
    const documents = await documentsWrittenByAsync(async () => {
      await assert.rejects(bootWith({ ALLOWED_ADMIN_EMAILS: `admin@frankfurtleague.de,${refused}` }), /Invalid environment variables/);
    });

    assert.equal(documents[0]?.variables, "ALLOWED_ADMIN_EMAILS");
    // Every document, not the first: a second line is where a value reaches a container log unread.
    for (const document of documents) {
      const written = JSON.stringify(document);

      for (const secret of [refused, "jörg", "schule.de"]) {
        assert.equal(written.includes(secret), false, `a refusal line carried ${secret}`);
      }
    }
  });
});

describe("the sign-in library's own rule", () => {
  /* The endpoint's own body schema, not a copy of its pattern: `fl_frontend/src/core/auth.ts`
     registers this plugin and `fl_frontend/src/core/auth.test.ts` drives the endpoint through it,
     so what this object refuses is what an administrator's request for a link meets. */
  const libraryBody = magicLink({ sendMagicLink: async () => undefined }).endpoints.signInMagicLink.options.body;

  const libraryTakes = (folded: string): boolean => libraryBody.safeParse({ email: folded }).success;

  /* An agreement over a table of refusals alone agrees on everything, and a table short of the
     clauses agrees on the ones it left out. */
  it("compares a table that covers both regexes and carries an answer of each kind", () => {
    const answers = ADDRESS_TABLE.map(([, address]) => libraryTakes(asSignInIdentifier(address)));

    assert.ok(ADDRESS_TABLE.length >= 12, `the table holds ${String(ADDRESS_TABLE.length)} rows`);
    assert.ok(answers.includes(true), "the library takes nothing in the table");
    assert.ok(answers.includes(false), "the library takes everything in the table");
  });

  /* Two zod copies are installed and this module resolves the one the library does not, so a release
     moving either regex is a lock-out that nothing else here would catch. */
  it("answers each address the way the allowlist's own predicate does", () => {
    for (const [clause, address] of ADDRESS_TABLE) {
      const folded = asSignInIdentifier(address);

      assert.equal(isSignInLibraryAddress(folded), libraryTakes(folded), `disagreed on ${clause}: ${address}`);
    }
  });
});

describe("the value an admin session is signed with", () => {
  it("refuses a value one character under the sign-in library's floor, and names the variable", async () => {
    assert.equal(await refusedNames({ AUTH_SECRET: artificialSecret(SIGNING_FLOOR - 1) }), "AUTH_SECRET");
  });

  it("boots at the floor", async () => {
    const value = artificialSecret(SIGNING_FLOOR);

    assert.equal((await bootWith({ AUTH_SECRET: value }))["AUTH_SECRET"], value);
  });

  /* The library only warns below the floor, so the refusal here is the only thing standing between a
     short value and every admin session signed with it. */
  it("carries no part of the refused value into the line an operator reads", async () => {
    const refused = artificialSecret(SIGNING_FLOOR - 1);
    const documents = await documentsWrittenByAsync(async () => {
      await assert.rejects(bootWith({ AUTH_SECRET: refused }), /Invalid environment variables/);
    });

    assert.equal(documents[0]?.variables, "AUTH_SECRET");
    for (const document of documents) {
      const written = JSON.stringify(document);

      for (const fragment of [refused, refused.slice(0, 12), refused.slice(-12)]) {
        assert.equal(written.includes(fragment), false, "a refusal line carried part of the value");
      }
    }
  });
});
