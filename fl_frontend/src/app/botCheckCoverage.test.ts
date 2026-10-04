import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { blankComments } from "@/core/blankComments.ts";
import { filesUnder, isTestFile } from "@/core/treeWalk.ts";

const SRC = path.resolve(import.meta.dirname, "..");

/** The spine every route handler a visitor with no session reaches runs through. */
const ANONYMOUS_SPINE = /\bhandlePublicRequest\(/;

/** The spines that turn away every caller holding no session: a write behind one is a signed-in person's. */
const SESSION_SPINES =
  /\b(?:runAdminMutation|runAdminRouteWrite|runPersonMutation|runPersonRecordMutation|runKontoMutation|handleUndoRequest)\(/;

/** Cloudflare's check, as `fl_frontend/src/core/turnstile.ts :: passesTurnstile` asks it. */
const BOT_CHECK = /\bpassesTurnstile\(/;

/**
 * Every anonymous entry point that may go without the bot check, and why. A reason names what stops a
 * script mailing an address of its choosing through it; „it needs none“ is no reason.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  "app/api/bestaetigung/kontakt/route.ts": "its credential is a link the league minted and mailed; it mails no address the request types",
  "app/api/bestaetigung/spieler/route.ts": "its credential is a link the league minted and mailed; it mails no address the request types",
  "app/api/bestaetigung/schiedsrichter/route.ts":
    "its credential is a link the league minted and mailed; it mails no address the request types",
  "app/api/bewerbung/kuerzel/route.ts": "a read: it writes nothing and mails nobody",
  "features/auth/actions.ts :: signOutAction": "it ends the caller's own session and mails nobody",
};

const relative = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

/** Each exported function of a server-action module that runs no session spine, and whether it reaches the check. */
function unguardedActions(file: string, text: string): { name: string; checked: boolean }[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bodies = new Map<string, string>();
  const exported: string[] = [];
  for (const statement of source.statements) {
    if (!ts.isFunctionDeclaration(statement) || statement.name === undefined || statement.body === undefined) continue;
    bodies.set(statement.name.text, blankComments(statement.body.getText(source), file));
    if (statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) exported.push(statement.name.text);
  }

  // One step into the module's own helpers: the sign-in action asks through one, which is a function of
  // this module and never another's.
  const reaches = (body: string): boolean =>
    BOT_CHECK.test(body) || [...bodies].some(([name, helper]) => new RegExp(`\\b${name}\\(`).test(body) && BOT_CHECK.test(helper));

  return exported
    .filter((name) => !SESSION_SPINES.test(bodies.get(name) ?? ""))
    .map((name) => ({ name: name, checked: reaches(bodies.get(name) ?? "") }));
}

/** Every route handler a visitor with no session reaches, by its path under `src/`, and whether it asks the check. */
const ROUTES = filesUnder(path.join(SRC, "app", "api"), (name) => name === "route.ts", 10)
  .map((file) => ({ file: file, text: blankComments(readFileSync(file, "utf8"), file) }))
  .filter(({ text }) => ANONYMOUS_SPINE.test(text))
  .map(({ file, text }) => ({ subject: relative(file), checked: BOT_CHECK.test(text) }));

/** Every server action reachable with no session, as `<module> :: <name>`, and whether it reaches the check. */
const ACTIONS = filesUnder(SRC, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 200)
  .map((file) => ({ file: file, text: readFileSync(file, "utf8") }))
  .filter(({ text }) => /^"use server";/m.test(text))
  .flatMap(({ file, text }) =>
    unguardedActions(file, text).map(({ name, checked }) => ({ subject: `${relative(file)} :: ${name}`, checked: checked })),
  );

const SUBJECTS = [...ROUTES, ...ACTIONS];

describe("every anonymous entry point", () => {
  /* `docs/frontend/spec.md :: I821`: a public form added without the check mails whatever address a
     script types, which is what the check exists to stop. */
  it("asks Cloudflare's bot check, or carries an exemption saying why it need not", () => {
    const unchecked = SUBJECTS.filter(({ subject, checked }) => !checked && EXEMPT[subject] === undefined).map(({ subject }) => subject);

    assert.deepEqual(unchecked, [], "these reach no `passesTurnstile` and carry no exemption");
  });

  /* A stale exemption would excuse whatever later takes its name; one on an entry point that does ask
     the check is a reason nobody needs. */
  it("is exempted only where it exists and does not ask the check", () => {
    const standing = new Map(SUBJECTS.map(({ subject, checked }) => [subject, checked]));

    assert.deepEqual(
      Object.keys(EXEMPT).filter((subject) => standing.get(subject) !== false),
      [],
      "these exemptions name no anonymous entry point, or one that asks the check",
    );
  });

  /* Floors, so a reader that stops matching cannot pass by finding nothing: the three forms that mail
     a typed address are each a subject, and each asks the check. */
  it("includes the sign-in's code request and the two public forms, each asking the check", () => {
    const checked = new Map(SUBJECTS.map(({ subject, checked }) => [subject, checked]));

    for (const subject of ["features/auth/actions.ts :: handleSignIn", "app/api/bewerbung/route.ts", "app/api/registrierung/route.ts"]) {
      assert.equal(checked.get(subject), true, `${subject} is no subject, or asks no check`);
    }
  });
});

describe("the reader of a server-action module", () => {
  /* Against a sample, which the tree alone cannot give: every unguarded action in it may already ask. */
  it("tells an unguarded action asking the check, directly or through a helper, from one that does not", () => {
    const sample = [
      '"use server";',
      "async function admits() { return passesTurnstile(token); }",
      "export async function direct() { await passesTurnstile(token); }",
      "export async function viaHelper() { await admits(); }",
      "export async function bare() { await sendMail(); }",
      "// passesTurnstile(",
      "export async function commented() { /* passesTurnstile( */ }",
      "export async function guarded() { return runAdminMutation(async () => sendMail()); }",
    ].join("\n");

    assert.deepEqual(unguardedActions("sample.ts", sample), [
      { name: "direct", checked: true },
      { name: "viaHelper", checked: true },
      { name: "bare", checked: false },
      { name: "commented", checked: false },
    ]);
  });
});
