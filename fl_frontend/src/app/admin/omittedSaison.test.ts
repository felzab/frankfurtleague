import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { filesUnder } from "@/core/treeWalk.ts";

import "@/shared/testing/renderTest.ts";

import type { ReactElement } from "react";

/** Every read a page asks the backend for, as the client was handed it. */
const READS = "__flOmittedSaisonReads";
/** How the doubled client answers one read: a world with no season running. */
const ANSWER = "__flOmittedSaisonAnswer";

const API_DOUBLE = `export const apiClient = async (endpoint, schema, options = {}) => {
  globalThis.${READS}.push({ endpoint, params: options.params ?? {} });
  return globalThis.${ANSWER}(endpoint, schema);
};`;

/* The request-only and cache-only halves of Next, which this process has no request or cache for. */
const PACKAGE_DOUBLES: Record<string, string> = {
  "server-only": "export {};",
  "next/server": "export const connection = async () => undefined;",
  "next/headers": "export const headers = async () => new Headers(); export const cookies = async () => ({ get: () => undefined });",
  "next/cache":
    "export const cacheTag = () => {}; export const cacheLife = () => {}; export const updateTag = () => {}; export const refresh = () => {}; export const revalidateTag = () => {};",
};

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/api.ts")) return { format: "module", source: API_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { APIBadStatusError } = await import("@/core/errors.ts");

type Read = { endpoint: string; params: Record<string, unknown> };
type Schema = {
  safeParse: (value: unknown) => { success: boolean; data?: unknown };
  shape?: Record<string, Schema>;
  values?: Set<unknown>;
  enum?: Record<string, unknown>;
};

const globals = globalThis as unknown as Record<string, unknown>;
const reads: Read[] = [];
globals[READS] = reads;

/** The empty answer a field takes, tried in order: a list read with nothing in it lets the page read on. */
const EMPTIES: unknown[] = [[], null, 0, "", false];

/** The emptiest value a schema takes: a literal's or an enum's first member, an object's fields each emptied. */
function emptiest(schema: Schema): unknown {
  const candidates = [
    ...(schema.values ?? []),
    ...Object.values(schema.enum ?? {}),
    ...EMPTIES,
    ...(schema.shape === undefined ? [] : [Object.fromEntries(Object.entries(schema.shape).map(([key, field]) => [key, emptiest(field)]))]),
  ];
  return candidates.find((candidate) => schema.safeParse(candidate).success);
}

/**
 * No season runs: the current-season read answers its 404, and every other read the emptiest body its
 * schema takes. A body no empty satisfies is refused, which ends that page's render there.
 */
globals[ANSWER] = (endpoint: string, schema: Schema): unknown => {
  if (endpoint === "/saisons/current") {
    throw new APIBadStatusError({
      message: "no season is active",
      url: `http://backend/api/v0${endpoint}`,
      statusCode: 404,
      serverErrorCode: "DB-NOTFOUND-001",
      endpoint: endpoint,
      method: "GET",
      readOnly: true,
      traceId: "0",
    });
  }

  const parsed = schema.safeParse(emptiest(schema));
  if (parsed.success) return parsed.data;

  throw new Error(`no empty answer for ${endpoint}`);
};

/** Calls every component a page's tree reaches, awaiting the async ones, so each read it makes is made. */
async function reach(node: unknown, depth = 0): Promise<void> {
  if (depth > 60 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) await reach(child, depth + 1);
    return;
  }
  if (node instanceof Promise) {
    await reach(await node.catch(() => null), depth + 1);
    return;
  }

  const element = node as Partial<ReactElement<Record<string, unknown>>>;
  if (element.props === undefined) return;

  for (const value of Object.values(element.props)) await reach(value, depth + 1);

  // Async ones alone: a server component that reads is async, and calling a client component outside
  // a render trips its hooks. A sync server component's children are reached through its props above.
  if (typeof element.type === "function" && element.type.constructor.name === "AsyncFunction") {
    // A refusal is the component's own answer and says nothing about the reads made before it.
    try {
      await reach(await (element.type as (props: unknown) => unknown)(element.props), depth + 1);
    } catch {
      // The reads made before the throw are already recorded.
    }
  }
}

const APP_DIR = import.meta.dirname;
const GROUP_DIR = path.join(APP_DIR, "(current-saison)");

/** One value per dynamic segment: a season id for a season's, an object id for every other. */
function paramsFor(pageDir: string): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  for (const segment of path.relative(APP_DIR, pageDir).split(path.sep)) {
    const dynamic = /^\[(\.\.\.)?(\w+)\]$/.exec(segment);
    if (dynamic === null) continue;
    const name = dynamic[2]!;
    params[name] = dynamic[1] !== undefined ? ["nirgendwo"] : name === "saison_id" ? "2026" : "6890a1b2c3d4e5f607250001";
  }
  return params;
}

/** The reads one page makes with no `?saison_id=` in its address. */
async function readsOf(page: string): Promise<Read[]> {
  reads.length = 0;
  const { default: Page } = (await import(pathToFileURL(page).href)) as { default: (props: unknown) => unknown };
  const props = { params: Promise.resolve(paramsFor(path.dirname(page))), searchParams: Promise.resolve({}) };

  try {
    await reach(await Page(props));
  } catch {
    // As in `reach`: what was read before the throw is recorded.
  }
  return [...reads];
}

/**
 * Every published read, marked where it takes an optional `saison_id`: an omitted one is resolved to
 * the running season, which answers 404 while none runs.
 */
const OPENAPI = JSON.parse(readFileSync(path.resolve(APP_DIR, "..", "..", "..", "..", "fl_backend", "openapi.json"), "utf8")) as {
  paths: Record<string, Record<string, { parameters?: { name: string; in: string }[] }>>;
};
const READ_ROUTES = Object.entries(OPENAPI.paths)
  .filter(([, operations]) => operations.get !== undefined)
  .map(([template, operations]) => ({
    template,
    literal: template.replace(/^\/api\/v\d+/, ""),
    pattern: new RegExp(`^${template.replace(/^\/api\/v\d+/, "").replace(/\{[^}]+\}/g, "[^/]+")}$`),
    takesSaison: operations.get!.parameters?.some((parameter) => parameter.name === "saison_id" && parameter.in === "query") ?? false,
  }));

/** The route one read reaches: a literal path before a templated one, as the backend declares its literals first. */
const routeOf = (endpoint: string) =>
  READ_ROUTES.find(({ literal }) => literal === endpoint) ?? READ_ROUTES.find(({ pattern }) => pattern.test(endpoint));

/** The reads among them whose omitted season means every season rather than the running one. */
const EVERY_SEASON_WHEN_OMITTED: Record<string, string> = {
  "/api/v0/bewerbungen": "the queue across every season, as `saisonbezug` with both values is",
};

/** Each read one page makes with no season named, against an endpoint that resolves it to the running one. */
function omitting(page: string, pageReads: Read[]): string[] {
  return pageReads.flatMap(({ endpoint, params }) => {
    if (params.saison_id !== undefined && params.saison_id !== null) return [];
    const hit = routeOf(endpoint);
    if (hit === undefined || !hit.takesSaison || EVERY_SEASON_WHEN_OMITTED[hit.template] !== undefined) return [];
    return [`${path.relative(APP_DIR, page).split(path.sep).join("/")} :: ${endpoint}`];
  });
}

const PAGES = filesUnder(APP_DIR, (name) => name === "page.tsx", 20);
const GUARDED = PAGES.filter((page) => page.startsWith(GROUP_DIR + path.sep));
const OUTSIDE = PAGES.filter((page) => !page.startsWith(GROUP_DIR + path.sep));

const READS_BY_PAGE = new Map<string, Read[]>();
for (const page of PAGES) READS_BY_PAGE.set(page, await readsOf(page));

describe("the admin pages outside the running-season guard, while no season runs", () => {
  /* The control: the sweep sees the omission the guard exists for. A reader blind to it passes the
     case below on every page. */
  it("finds the omitted season on every page inside the guard", () => {
    for (const page of GUARDED) {
      assert.notDeepEqual(omitting(page, READS_BY_PAGE.get(page)!), [], `${page} reads nothing this sweep would call a default`);
    }
  });

  /* `docs/frontend/spec.md :: I359`: such a page answers the backend's 404 with the error page, and
     only the group's layout sends the admin somewhere that works. */
  it("pass no omitted season to a read that resolves it to the running one", () => {
    const found = OUTSIDE.flatMap((page) => omitting(page, READS_BY_PAGE.get(page)!));

    assert.deepEqual(found, [], "move the page into `app/admin/(current-saison)/`, or name the season it reads");
  });

  /* A floor: pages that threw before any read would pass the case above having shown nothing. */
  it("reached the backend from the pages it swept", () => {
    const reading = OUTSIDE.filter((page) => READS_BY_PAGE.get(page)!.length > 0);

    assert.ok(reading.length >= OUTSIDE.length / 2, `only ${String(reading.length)} of ${String(OUTSIDE.length)} pages made a read`);
  });
});
