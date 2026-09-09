import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, describe, it } from "node:test";

import { documentsWrittenBy } from "./stdoutCapture.ts";

/** Stands in for `server-only`, whose real module throws outside a React server build. */
const SERVER_ONLY_DOUBLE_URL = `data:text/javascript,${encodeURIComponent("export {};")}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") return { url: SERVER_ONLY_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { ADMIN_EMAIL_ALLOWLIST, failingVariableNames, INTERNAL_API_KEY, refuseInvalidEnvironment } = await import("./config.ts");

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
