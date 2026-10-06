// The harness that compiles `.tsx`, which Node strips no JSX from: a `route.tsx` is as much a handler,
// and this sweep sits in `app/` because core may not load the harness.
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { routeHandlerFiles } from "@/core/treeWalk.ts";

const APP_DIR = import.meta.dirname;

const inert = (): undefined => undefined;

/** Next's response as the sweep reads one: the status a handler answered, and its body. */
class NextResponseDouble {
  readonly body: unknown;
  readonly status: number;

  constructor(body: unknown, init?: ResponseInit) {
    this.body = body;
    this.status = init?.status ?? 200;
  }

  static json(body: unknown, init?: ResponseInit): NextResponseDouble {
    return new NextResponseDouble(body, init);
  }

  static redirect(_url: unknown, status?: number): NextResponseDouble {
    return new NextResponseDouble(null, { status: status ?? 307 });
  }
}

/* Each handler runs for real against these: a refused request must reach none of them, and a
   request let through reaches whichever it reaches first, which the request itself records. */
const PACKAGE_DOUBLES = {
  "next/cache": { updateTag: inert, refresh: inert, revalidateTag: inert, cacheTag: inert, cacheLife: inert },
  "next/headers": { headers: () => Promise.resolve(new Headers()) },
  "next/server": { NextResponse: NextResponseDouble, after: inert, connection: () => Promise.resolve() },
  "next/navigation": { unstable_rethrow: inert },
};

const ADMINISTRATOR = { user: { email: "vorstand@example.org" } };

/**
 * Each module replaced whole, its export names read off the real one: a route importing a name a
 * double left out fails to link, and the sweep's worker then exits without reporting a case.
 */
const MODULE_DOUBLES = {
  // No export doubled: each throws where called, as a request past the guard reaching the backend would.
  "core/api.ts": {},
  "core/logging.ts": { logger: { debug: inert, info: inert, warn: inert, error: inert } },
  "core/config.ts": { frontend_config: { AUTH_URL: "http://localhost:3000", LOG_LEVEL: "ERROR", LOG_FORMAT: "json" } },
  // Signed in, so the undo spine's session check lets a request through to the body it reads.
  "core/auth.ts": {
    auth: { handler: async (request: Request) => new Response(request.url), api: {} },
    ADDRESS_ATTEMPTS_EXHAUSTED: "ADDRESS_ATTEMPTS_EXHAUSTED",
    forgiveCodeAttempt: async () => undefined,
    getAdminSession: async () => ADMINISTRATOR,
    judgeAdminRequest: async () => ({ session: ADMINISTRATOR }),
    isFreshlySignedIn: () => true,
  },
};
const mail = doubleSendMail();

registerDoubles({ modules: MODULE_DOUBLES, specifiers: PACKAGE_DOUBLES });

/** Every method Next routes to a handler. */
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Handler = (request: unknown, context: unknown) => Promise<unknown>;

/** The handlers this guard must not stand in front of, and why. */
const UNGUARDED: Record<string, string> = {
  "api/auth/[...all]/route.ts GET":
    "the library's own hook refuses every GET but the passkey's options, which hand out only a challenge its verify checks",
  "api/auth/[...all]/route.ts POST": "the sign-in library brings an origin check of its own to every path a browser posts to",
  "api/mail/zustellung/route.ts POST":
    "the provider's delivery webhook, which a 200 from the spine would tell that a forgery and an unreachable backend were both accepted",
};
const UNGUARDED_BY_DECISION = Object.keys(UNGUARDED);

// Next's own routing convention decides this listing, so a handler added tomorrow is swept with no edit here.
const HANDLERS: { name: string; handler: Handler }[] = [];
for (const file of routeHandlerFiles(8)) {
  const routeModule = (await import(pathToFileURL(file).href)) as Partial<Record<(typeof METHODS)[number], Handler>>;
  for (const method of METHODS) {
    const handler = routeModule[method];
    if (handler !== undefined) HANDLERS.push({ name: `${path.relative(APP_DIR, file).split(path.sep).join("/")} ${method}`, handler });
  }
}

/**
 * What one handler read of a request carrying `secFetchSite`, the guard's own header aside, and what
 * it answered. A guard refuses before it reads anything else, so an empty list is a refusal.
 */
async function send(handler: Handler, secFetchSite: string | null): Promise<{ read: string[]; answered: unknown }> {
  const read: string[] = [];
  const headers = new Headers(secFetchSite === null ? {} : { "sec-fetch-site": secFetchSite });
  const watchedHeaders = new Proxy(headers, {
    get(target, key) {
      if (key !== "get") read.push(`headers.${String(key)}`);
      const value = Reflect.get(target, key, target) as unknown;
      if (key !== "get" || typeof value !== "function") return typeof value === "function" ? value.bind(target) : value;
      return (name: string) => {
        if (name.toLowerCase() !== "sec-fetch-site") read.push(`headers.get(${name})`);
        return target.get(name);
      };
    },
  });
  const url = "http://localhost:3000/api/sweep?shorthand=AB";
  const request = new Proxy(
    {
      headers: watchedHeaders,
      method: "POST",
      url: url,
      nextUrl: new URL(url),
      json: async () => ({}),
      text: async () => "",
      formData: async () => new FormData(),
    },
    {
      get(target, key, receiver) {
        if (key !== "headers") read.push(String(key));
        return Reflect.get(target, key, receiver) as unknown;
      },
    },
  );

  let answered: unknown;
  try {
    answered = await handler(request, { params: Promise.resolve({ all: ["session"] }) });
  } catch (error) {
    answered = error;
  }
  return { read, answered };
}

describe("the cross-site guard every session-less route stands behind", () => {
  /* The control: a sweep loading no handler, or losing the exempt ones to a rename, judges nothing. */
  it("sweeps every handler the exemptions name", () => {
    const names = HANDLERS.map(({ name }) => name);

    for (const exempt of UNGUARDED_BY_DECISION) assert.ok(names.includes(exempt), `${exempt} is no longer among the swept handlers`);
    assert.ok(names.length > UNGUARDED_BY_DECISION.length, "the sweep reached no guarded handler");
  });

  /* Refused unread: every weakening of the guard — a widened condition, a refusal built and not
     returned — lets the request reach the next line, which reads it. */
  it("refuses a cross-site request before reading it, on every handler bar the ones that must not be guarded", async () => {
    const through: string[] = [];
    for (const { name, handler } of HANDLERS) {
      const { read, answered } = await send(handler, "cross-site");
      if (read.length > 0) through.push(name);
      else assert.ok(answered !== undefined && !(answered instanceof Error), `${name} refuses by answering nothing`);
    }

    assert.deepEqual(through.sort(), [...UNGUARDED_BY_DECISION].sort());
    assert.deepEqual(mail.sent, [], "a cross-site request reached the mailer");
  });

  /* `null` passes deliberately: a browser too old to send the header is still a reader of this page. */
  it("lets a same-origin request and one sending no header through, and refuses every other value", async () => {
    for (const { name, handler } of HANDLERS.filter((entry) => !UNGUARDED_BY_DECISION.includes(entry.name))) {
      for (const secFetchSite of ["same-origin", null]) {
        assert.notDeepEqual((await send(handler, secFetchSite)).read, [], `${name} refuses a request sent with ${String(secFetchSite)}`);
      }
      for (const secFetchSite of ["same-site", "none"]) {
        assert.deepEqual((await send(handler, secFetchSite)).read, [], `${name} lets a request sent with ${secFetchSite} through`);
      }
    }
  });
});
