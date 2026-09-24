import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { filesUnder } from "@/core/treeWalk.ts";

import "@/shared/testing/renderTest.ts";

import type { FLSaison, FLSaisonRules, FLSaisonStatus } from "@/features/saisons/schemas.ts";
import type { ReactElement } from "react";

/** Every read a page asks the backend for, as the client was handed it. */
const READS = "__flOmittedSaisonReads";
/** How the doubled client answers one read, in the league the case sets up. */
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
const { FLSaisonSchema } = await import("@/features/saisons/schemas.ts");

type Read = { endpoint: string; params: Record<string, unknown> };
type Schema = {
  safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: unknown };
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

const RULES: FLSaisonRules = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_group: 2,
  number_of_groups: 2,
  teams_per_group: 4,
  max_kadergroesse: 18,
  tiebreak_order: "tordifferenz",
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  erlaubte_stufen: ["E1", "Q1"],
};

const saison = (id: string, status: FLSaisonStatus): FLSaison =>
  FLSaisonSchema.parse({
    id: id,
    start_date: `${id}-03-07`,
    end_date: `${id}-10-31`,
    status: status,
    rules: RULES,
    schedule: [],
    spielplan: null,
    bewerbung: null,
    registrierung: null,
  });

/** The league every read answers from; each case sets its own. */
let league: FLSaison[] = [];

/** A response the page's schema takes, carrying `fields` over the emptiest one it accepts. */
function answer(schema: Schema, endpoint: string, fields: Record<string, unknown>): unknown {
  const parsed = schema.safeParse({ ...(emptiest(schema) as object), ...fields });
  if (!parsed.success) throw new Error(`no answer for ${endpoint}`);
  return parsed.data;
}

/**
 * The season reads answer from `league`, the running one with its 404 while none is active, and every
 * other read with the emptiest body its schema takes. A body no empty satisfies is refused, which ends
 * that page's render there.
 */
globals[ANSWER] = (endpoint: string, schema: Schema): unknown => {
  const running = league.find((entry) => entry.status === "active");

  if (endpoint === "/saisons/current") {
    if (running !== undefined) return answer(schema, endpoint, { saison: running });
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
  // The public list withholds a planned season, as `GET /saisons` does.
  if (endpoint === "/saisons") return answer(schema, endpoint, { saisons: league.filter((entry) => entry.status !== "future") });
  if (endpoint === "/saisons/list/admin") return answer(schema, endpoint, { saisons: league });

  const parsed = schema.safeParse(emptiest(schema));
  if (parsed.success) return parsed.data;

  throw new Error(`no empty answer for ${endpoint}`);
};

/** Where a thrown redirect sends the reader, read off the digest Next's `redirect()` stamps. */
const redirectTarget = (error: unknown): string | null => {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;") ? (digest.split(";")[2] ?? null) : null;
};

/** What one page did in one league: the reads it made, and where it redirected, if it did. */
type Visit = { reads: Read[]; redirects: string[] };

/** Calls every component a page's tree reaches, awaiting the async ones, so each read it makes is made. */
async function reach(node: unknown, visit: Visit, depth = 0): Promise<void> {
  if (depth > 60 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) await reach(child, visit, depth + 1);
    return;
  }
  if (node instanceof Promise) {
    await reach(await node.catch(() => null), visit, depth + 1);
    return;
  }

  const element = node as Partial<ReactElement<Record<string, unknown>>>;
  if (element.props === undefined) return;

  for (const value of Object.values(element.props)) await reach(value, visit, depth + 1);

  // Async ones alone: a server component that reads is async, and calling a client component outside
  // a render trips its hooks. A sync server component's children are reached through its props above.
  if (typeof element.type === "function" && element.type.constructor.name === "AsyncFunction") {
    // A refusal is the component's own answer and says nothing about the reads made before it.
    try {
      await reach(await (element.type as (props: unknown) => unknown)(element.props), visit, depth + 1);
    } catch (error) {
      const target = redirectTarget(error);
      if (target !== null) visit.redirects.push(target);
    }
  }
}

const APP_DIR = import.meta.dirname;

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

/** What one page does in `league`, with `searchParams` as its address's query. */
async function visit(page: string, searchParams: Record<string, string>): Promise<Visit> {
  reads.length = 0;
  const result: Visit = { reads: [], redirects: [] };
  const { default: Page } = (await import(pathToFileURL(page).href)) as { default: (props: unknown) => unknown };
  const props = { params: Promise.resolve(paramsFor(path.dirname(page))), searchParams: Promise.resolve(searchParams) };

  try {
    await reach(await Page(props), result);
  } catch (error) {
    // As in `reach`: what was read before the throw is recorded.
    const target = redirectTarget(error);
    if (target !== null) result.redirects.push(target);
  }
  result.reads = [...reads];
  return result;
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

const label = (page: string) => path.relative(APP_DIR, page).split(path.sep).join("/");

/** Each read one page makes with no season named, against an endpoint that resolves it to the running one. */
function omitting(page: string, pageReads: Read[]): string[] {
  return pageReads.flatMap(({ endpoint, params }) => {
    if (params.saison_id !== undefined && params.saison_id !== null) return [];
    const hit = routeOf(endpoint);
    if (hit === undefined || !hit.takesSaison || EVERY_SEASON_WHEN_OMITTED[hit.template] !== undefined) return [];
    return [`${label(page)} :: ${endpoint}`];
  });
}

/** Each read one page makes against an endpoint taking a season, naming any season but `expected`. */
function naming(page: string, pageReads: Read[], expected: string): string[] {
  return pageReads.flatMap(({ endpoint, params }) =>
    routeOf(endpoint)?.takesSaison === true && params.saison_id !== expected
      ? [`${label(page)} :: ${endpoint} :: ${String(params.saison_id)}`]
      : [],
  );
}

const PAGES = filesUnder(APP_DIR, (name) => name === "page.tsx", 20);
/* A `[saison_id]` segment names the page's subject, which `resolveSaisonIdParam` answers with no
   fallback, so the header's season is not the one it reads. */
const SEASON_ADDRESSED = PAGES.filter((page) => path.relative(APP_DIR, page).split(path.sep).includes("[saison_id]"));

/** Every page visited in one league, sequentially, since the doubled client records into one list. */
async function visitAll(saisons: FLSaison[], searchParams: Record<string, string>): Promise<Map<string, Visit>> {
  league = saisons;
  const visits = new Map<string, Visit>();
  for (const page of PAGES) visits.set(page, await visit(page, searchParams));
  return visits;
}

/* One per state the header's selector resolves, which is what every admin page must agree with
   (`docs/frontend/spec.md :: I359`). The planned-only league is the one before a first activation,
   the only league I18 leaves without a running season. */
const RUNNING_LEAGUE = [saison("2025", "past"), saison("2026", "active"), saison("2027", "future")];
const LEAGUES = [
  { name: "a season runs", visits: await visitAll(RUNNING_LEAGUE, {}), shows: "2026" },
  { name: "the address names a planned season", visits: await visitAll(RUNNING_LEAGUE, { saison_id: "2027" }), shows: "2027" },
  { name: "no season has run yet", visits: await visitAll([saison("2026", "future"), saison("2027", "future")], {}), shows: "2026" },
];
const EMPTY_LEAGUE = await visitAll([], {});

describe("the season every admin page reads", () => {
  /* The control: the sweeps below see an omission and a wrong season. A reader blind to either passes
     them on every page. */
  it("tells an omitted or another season from the one the header shows", () => {
    const page = path.join(APP_DIR, "control", "page.tsx");

    assert.deepEqual(omitting(page, [{ endpoint: "/spiele/list/admin", params: {} }]), ["control/page.tsx :: /spiele/list/admin"]);
    assert.deepEqual(omitting(page, [{ endpoint: "/spiele/list/admin", params: { saison_id: "2026" } }]), []);
    assert.equal(naming(page, [{ endpoint: "/spiele/list/admin", params: { saison_id: "2025" } }], "2026").length, 1);
  });

  for (const { name, visits, shows } of LEAGUES) {
    it(`reads the season the header shows where ${name}`, () => {
      const found = [...visits]
        .filter(([page]) => !SEASON_ADDRESSED.includes(page))
        .flatMap(([page, { reads: pageReads }]) => naming(page, pageReads, shows));

      assert.deepEqual(found, [], `resolve the page's season with \`resolveAdminSaison\`; the header shows ${shows}`);
    });

    /* A page redirected away makes no read for the case above to judge, so the fallback it lost would
       pass unseen. */
    it(`sends no page away where ${name}`, () => {
      const redirects = [...visits].flatMap(([page, { redirects: targets }]) => targets.map((target) => `${label(page)} -> ${target}`));

      assert.deepEqual(redirects, []);
    });

    /* A floor: pages that threw before any read would pass the case above having shown nothing. */
    it(`reached the backend from the pages it swept where ${name}`, () => {
      const reading = [...visits.values()].filter((entry) => entry.reads.length > 0);
      const seasonReading = [...visits.values()].filter((entry) => entry.reads.some(({ endpoint }) => routeOf(endpoint)?.takesSaison === true));

      assert.ok(reading.length >= PAGES.length / 2, `only ${String(reading.length)} of ${String(PAGES.length)} pages made a read`);
      assert.ok(seasonReading.length > 0, "no page made a read taking a season, so the case above proves nothing");
    });
  }

  /* `docs/frontend/spec.md :: I363`: an omitted season is answered with the backend's 404, which the
     page renders as its error page. */
  it("passes no omitted season to a read where the league holds none", () => {
    const found = [...EMPTY_LEAGUE].flatMap(([page, { reads: pageReads }]) => omitting(page, pageReads));

    assert.deepEqual(found, [], "a page whose reads need a season takes it from `requireAdminSaison`");
  });

  it("sends the admin to the season list, and only there, where the league holds none", () => {
    const redirects = [...EMPTY_LEAGUE].flatMap(([page, { redirects: targets }]) => targets.map((target) => `${label(page)} -> ${target}`));

    assert.ok(redirects.length > 0, "no page redirected, so the case below proves nothing");
    assert.deepEqual(
      redirects.filter((entry) => !entry.endsWith(" -> /admin/saisons")),
      [],
    );
  });
});
