// The harness that compiles `.tsx`, which Node strips no JSX from: a `route.tsx` is as much a handler.
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";

import { registerDoubles } from "@/core/exportingModule.ts";
import { routeHandlerFiles, serverActionModules } from "@/core/treeWalk.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";

const SRC = path.resolve(import.meta.dirname, "..");

/** What the doubled check answers every request: a sentence no other refusal can share. */
const REFUSED = "the bot check's refusal, as this sweep doubles it";

/** How often the check was asked since the subject was called. */
let asked = 0;

/* Nobody signed in, so every session spine turns its caller away; the check refusing whatever it is
   handed, so an entry point asking it answers this sweep's own sentence. */
doubleActionRequest({ session: null });
registerDoubles({
  modules: {
    "core/turnstile.ts": {
      turnstileRefusal: () => {
        asked += 1;
        return Promise.resolve(REFUSED);
      },
    },
  },
});

const { ADMIN_FORBIDDEN } = await import("@/shared/utils/adminMutation.ts");
const { KONTO_FORBIDDEN } = await import("@/shared/utils/kontoMutation.ts");

/** The answers a session spine gives a caller nobody signed in as: a write behind one is a signed-in person's. */
const SESSION_REFUSALS: ReadonlySet<unknown> = new Set([ADMIN_FORBIDDEN, KONTO_FORBIDDEN]);

/** The statuses the undo spine turns such a caller away with, its body read by nobody. */
const SESSION_STATUSES: ReadonlySet<number> = new Set([401, 403]);

/**
 * Every anonymous entry point that may go without the bot check, and why; none is called. A reason names
 * what stops a script mailing an address of its choosing through it; „it needs none“ is no reason.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  "app/api/auth/[...all]/route.ts GET":
    "the sign-in library's own surface, every mailing endpoint of which `fl_frontend/src/core/auth.test.ts :: IN_PROCESS_ONLY` and `:: DISABLED_PATHS` keep off it",
  "app/api/auth/[...all]/route.ts POST":
    "the sign-in library's own surface, every mailing endpoint of which `fl_frontend/src/core/auth.test.ts :: IN_PROCESS_ONLY` and `:: DISABLED_PATHS` keep off it",
  "app/api/client-error/route.ts POST": "it writes one bounded log line and mails nobody",
  "app/api/signin/code/route.ts POST": "it checks a code already mailed, held to its per-address failure bound, and mails nobody",
  "app/api/mail/zustellung/route.ts POST":
    "the mail provider's webhook, its credential the provider's signature over the body; it mails nobody",
  "app/api/bestaetigung/kontakt/route.ts POST": "its credential is a link the league minted and mailed; it mails no address the request types",
  "app/api/bestaetigung/spieler/route.ts POST": "its credential is a link the league minted and mailed; it mails no address the request types",
  "app/api/bestaetigung/schiedsrichter/route.ts POST":
    "its credential is a link the league minted and mailed; it mails no address the request types",
  "app/api/bestaetigung/schiedsrichter/adresse/route.ts POST":
    "its credential is a link the league minted and mailed; it mails no address the request types",
  "app/api/bewerbung/kuerzel/route.ts GET": "a read: it writes nothing and mails nobody",
  "features/auth/actions.ts :: signOutAction": "it ends the caller's own session and mails nobody",
};

/** Every method Next routes to a handler. */
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Subject = { name: string; call: () => Promise<unknown> };

const relative = (file: string): string => path.relative(SRC, file).split(path.sep).join("/");

/** A request as a browser on this site posts one: same-origin, its body empty, no token in its header. */
function sameOriginRequest(): Request {
  return new Request("http://localhost:3000/api/sweep", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json" },
    body: "{}",
  });
}

// Every route handler and every export of every server-action module, by import rather than by reading
// their source: a handler written without a spine, or asking the check past a parse, is called like the rest.
const SUBJECTS: Subject[] = [];
for (const file of routeHandlerFiles(15)) {
  const handlers = (await import(pathToFileURL(file).href)) as Partial<
    Record<(typeof METHODS)[number], (...args: unknown[]) => Promise<unknown>>
  >;
  for (const method of METHODS) {
    const handler = handlers[method];
    if (handler !== undefined) {
      SUBJECTS.push({
        name: `${relative(file)} ${method}`,
        call: () => handler(sameOriginRequest(), { params: Promise.resolve({ all: [] }) }),
      });
    }
  }
}
for (const file of serverActionModules(20)) {
  for (const [name, action] of Object.entries((await import(pathToFileURL(file).href)) as Record<string, unknown>)) {
    assert.equal(typeof action, "function", `${relative(file)} :: ${name} is exported from a "use server" module and is no action`);
    SUBJECTS.push({
      name: `${relative(file)} :: ${name}`,
      call: () => (action as (...args: unknown[]) => Promise<unknown>)(undefined, new FormData()),
    });
  }
}

/** How a subject answered a caller with no session and no token: turned away, refused by the check, or neither. */
type Verdict = "session" | "checked" | "unchecked";

async function verdictOf(subject: Subject): Promise<Verdict> {
  asked = 0;
  const fetched = mock.method(globalThis, "fetch", () => Promise.reject(new Error("an entry point reached the network unchecked")));
  let answer: unknown;
  try {
    answer = await subject.call();
  } catch (error) {
    answer = error;
  } finally {
    fetched.mock.restore();
  }

  const status = answer instanceof Response ? answer.status : null;
  const body = answer instanceof Response ? ((await answer.json().catch(() => null)) as unknown) : answer;
  const error = typeof body === "object" && body !== null && "error" in body ? body.error : undefined;

  if ((status !== null && SESSION_STATUSES.has(status)) || SESSION_REFUSALS.has(error)) return "session";
  // Asked, its refusal the answer, and nothing sent: the check stood before every other step.
  return asked > 0 && error === REFUSED && fetched.mock.callCount() === 0 ? "checked" : "unchecked";
}

const VERDICTS = new Map<string, Verdict>();
for (const subject of SUBJECTS) {
  if (EXEMPT[subject.name] === undefined) VERDICTS.set(subject.name, await verdictOf(subject));
}

describe("every anonymous entry point", () => {
  /* `docs/frontend/spec.md :: I622`: a public form added without the check, or asking it after a parse or
     a read, answers a script before Cloudflare has judged it. */
  it("turns away a caller with no session, or answers the bot check's refusal before anything else, or carries an exemption", () => {
    const unchecked = [...VERDICTS].filter(([, verdict]) => verdict === "unchecked").map(([name]) => name);

    assert.deepEqual(unchecked, [], "these neither turn a session-less caller away nor answer the check's refusal first");
  });

  /* A stale exemption would excuse whatever later takes its name. */
  it("is exempted only where it exists", () => {
    const names = new Set(SUBJECTS.map(({ name }) => name));

    assert.deepEqual(
      Object.keys(EXEMPT).filter((name) => !names.has(name)),
      [],
      "these exemptions name no route handler or server action",
    );
  });

  /* Floors, so a population that stops loading cannot pass by judging nothing: the three entry points
     that mail a typed address are each judged, and each answers the check's refusal. */
  it("includes the sign-in's code request and the two public forms, each asking the check first", () => {
    for (const name of ["features/auth/actions.ts :: handleSignIn", "app/api/bewerbung/route.ts POST", "app/api/registrierung/route.ts POST"]) {
      assert.equal(VERDICTS.get(name), "checked", `${name} is no subject, or does not answer the check's refusal first`);
    }
    assert.ok(
      [...VERDICTS.values()].filter((verdict) => verdict === "session").length >= 20,
      "fewer than twenty session-guarded entry points were judged, so the population stopped loading",
    );
  });
});
