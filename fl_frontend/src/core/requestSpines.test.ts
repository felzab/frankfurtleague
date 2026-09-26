import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { doubleSendMail } from "./mailDouble.ts";
import { filesUnder } from "./treeWalk.ts";

const APP_DIR = path.resolve(import.meta.dirname, "..", "app");

/* Each handler runs for real against these: a refused request must reach none of them, and a
   request let through reaches whichever it reaches first, which the request itself records. */
const PACKAGE_DOUBLES: Record<string, string> = {
  "server-only": "export {};",
  "next/cache":
    "const inert = () => undefined; export { inert as updateTag, inert as refresh, inert as revalidateTag, inert as cacheTag, inert as cacheLife };",
  "next/headers": "export const headers = async () => new Headers();",
  "next/server": `export class NextResponse {
  constructor(body, init) { this.body = body; this.status = init?.status ?? 200; }
  static json(body, init) { return new NextResponse(body, init); }
  static redirect(url, status) { return new NextResponse(null, { status: status ?? 307 }); }
}
export const after = () => undefined;
export const connection = async () => undefined;`,
  "next/navigation": "export const unstable_rethrow = () => undefined;",
};

const unreached = (name: string) => `() => { throw new Error("${name} is past the guard and not doubled"); }`;

const MODULE_DOUBLES: Record<string, string> = {
  "/src/core/api.ts": `export const apiClient = ${unreached("the backend")};`,
  "/src/core/logging.ts": "const inert = () => undefined; export const logger = { debug: inert, info: inert, warn: inert, error: inert };",
  "/src/core/config.ts": `export const frontend_config = { AUTH_URL: "http://localhost:3000", LOG_LEVEL: "ERROR", LOG_FORMAT: "json" };`,
  // Signed in, so the undo spine's session check lets a request through to the body it reads.
  "/src/core/auth.ts": `export const auth = { handler: async (request) => new Response(request.url), api: {} };
export const SIGN_IN_LANDING = "/signin/weiter";
export const getAdminSession = async () => ({ user: { email: "vorstand@example.org" } });
export const getSignInDestination = async () => "/bereich/admin";`,
};
const mail = doubleSendMail();

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined
      ? nextResolve(specifier, context)
      : { url: `data:text/javascript,${encodeURIComponent(double)}`, shortCircuit: true };
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    const double = Object.entries(MODULE_DOUBLES).find(([ending]) => url.endsWith(ending))?.[1];
    return double === undefined ? nextLoad(url, context) : { format: "module", source: double, shortCircuit: true };
  },
});

/** Every method Next routes to a handler. */
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

type Handler = (request: unknown, context: unknown) => Promise<unknown>;

/** The handlers this guard must not stand in front of, and why. */
const UNGUARDED: Record<string, string> = {
  "api/auth/[...all]/route.ts GET":
    "the sign-in library's verification path is followed out of a mail client, so it arrives cross-site by construction",
  "api/auth/[...all]/route.ts POST": "the sign-in library brings an origin check of its own to every path a browser posts to",
  "api/mail/zustellung/route.ts POST":
    "the provider's delivery webhook, which a 200 from the spine would tell that a forgery and an unreachable backend were both accepted",
};
const UNGUARDED_BY_DECISION = Object.keys(UNGUARDED);

// Next's own routing convention decides this listing, so a handler added tomorrow is swept with no
// edit here. Both suffixes: `route.tsx` is as much a handler as `route.ts`.
const HANDLERS: { name: string; handler: Handler }[] = [];
for (const file of filesUnder(APP_DIR, (name) => name === "route.ts" || name === "route.tsx", 8)) {
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
