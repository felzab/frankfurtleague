import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { render } from "@testing-library/react";

import { readPublishedDocument } from "@/core/openapiDocument.ts";
import { filesUnder } from "@/core/treeWalk.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLSaison, FLSaisonRules, FLSaisonStatus } from "@/features/saisons/schemas.ts";
import type { ReactElement, ReactNode } from "react";

/** Every read a page asks the backend for, as the client was handed it. */
const READS = "__flOmittedSaisonReads";
/** How the doubled client answers one read, in the league the case sets up. */
const ANSWER = "__flOmittedSaisonAnswer";
/** The id of each season `resolveAdminSaison` or `requireAdminSaison` answered, `null` for none. */
const RESOLVED = "__flOmittedSaisonResolved";

const API_DOUBLE = `export const apiClient = async (endpoint, schema, options = {}) => {
  globalThis.${READS}.push({ endpoint, params: options.params ?? {} });
  return globalThis.${ANSWER}(endpoint, schema);
};`;

/* The real resolvers, each page-facing one recording its answer: a page picking its rows locally sends
   no season a read could show. */
const resolverDouble = (real: string) => `import * as real from ${JSON.stringify(real)};
export * from ${JSON.stringify(real)};
const recorded = (saison) => (globalThis.${RESOLVED}.push(saison?.id ?? null), saison);
export const resolveAdminSaison = async (searchParams) => recorded(await real.resolveAdminSaison(searchParams));
export const requireAdminSaison = async (searchParams) => recorded(await real.requireAdminSaison(searchParams));`;

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
    // The query keeps the real module's own url from matching here again.
    if (url.endsWith("/src/features/saisons/resolvers.ts"))
      return { format: "module", source: resolverDouble(`${url}?real`), shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { APIBadStatusError } = await import("@/core/errors.ts");
const { FLSaisonSchema } = await import("@/features/saisons/schemas.ts");
const { SaisonMetadataDisplay } = await import("@/features/saisons/components/ui/SaisonMetadataDisplay.tsx");

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
const resolved: (string | null)[] = [];
globals[RESOLVED] = resolved;

/** The season of every club or squad row a page read past its `saison_id`: the rows it picked. */
const picks: string[] = [];

/** A row recording into `picks`; comparing its `saison_id` alone picks nothing. */
const tracked = <T extends { saison_id: string }>(row: T): T =>
  new Proxy(row, {
    get(target, key, receiver) {
      // Serialised whole, as an editor's `key` serialises its club, the row is handed on rather than picked.
      if (key === "toJSON") return () => target;
      if (typeof key === "string" && key !== "saison_id") picks.push(target.saison_id);
      return Reflect.get(target, key, receiver) as unknown;
    },
  });

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

/** The id `paramsFor` gives every segment but a season's, so the club's and the player's editors open on these. */
const OBJECT_ID = "6890a1b2c3d4e5f607250001";

/* One club, and one player in its squad, holding a row in every season of the league: a page picking
   another season's row reads that row's fields. */
const club = (saisons: FLSaison[]) => ({
  id: OBJECT_ID,
  name: "FC Alpha",
  shorthand: "AL",
  description: "",
  full_name: "FC Alpha Frankfurt",
  website_url: null,
  address: { strasse: "Hauptstraße", hausnummer: "1", plz: "60311", stadtteil: "", stadt: "Frankfurt am Main" },
  schulform: null,
  inactive_since: null,
  memberships: saisons.map((entry) => ({
    saison_id: entry.id,
    gruppe: "A",
    austritt: null,
    trikot_farbe: null,
    kontakte: null,
    kontakte_stand: "",
  })),
});
const spieler = (saisons: FLSaison[]) => ({
  id: OBJECT_ID,
  vorname: "Ada",
  nachname: null,
  inactive_since: null,
  geburtsdatum: null,
  einwilligung: null,
  email: null,
  memberships: saisons.map((entry) => ({
    saison_id: entry.id,
    team_id: OBJECT_ID,
    nummer: null,
    position: null,
    stufe: null,
    ist_nachnominiert: false,
    rolle: null,
    inactive_since: null,
  })),
});

/** The league every read answers from; each case sets its own. */
let league: FLSaison[] = [];
/** What the cached running-season read answers, where it lags the list; `undefined` answers from `league`. */
let cachedCurrent: FLSaison | undefined;

/** A response the page's schema takes, carrying `fields` over the emptiest one it accepts. */
function answer(schema: Schema, endpoint: string, fields: Record<string, unknown>): unknown {
  // Field by field: a body whose `fields` no empty value could stand in for has no emptiest whole.
  const body = Object.fromEntries(
    Object.entries(schema.shape ?? {}).map(([key, field]) => [key, key in fields ? fields[key] : emptiest(field)]),
  );
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error(`no answer for ${endpoint}`);
  return parsed.data;
}

/** The same, each holder in `key` answering with its rows tracked. */
function withTrackedRows(schema: Schema, endpoint: string, key: string, holder: { memberships: { saison_id: string }[] }): unknown {
  const parsed = answer(schema, endpoint, { [key]: [holder] }) as Record<string, { memberships: { saison_id: string }[] }[]>;
  for (const entry of parsed[key] ?? []) entry.memberships = entry.memberships.map(tracked);
  return parsed;
}

/**
 * The season reads answer from `league`, the running one with its 404 while none is active, and every
 * other read with the emptiest body its schema takes. A body no empty satisfies is refused, which ends
 * that page's render there.
 */
globals[ANSWER] = (endpoint: string, schema: Schema): unknown => {
  const running = cachedCurrent ?? league.find((entry) => entry.status === "active");

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
  if (endpoint === "/teams/memberships") return withTrackedRows(schema, endpoint, "teams", club(league));
  if (endpoint === "/spieler/memberships") return withTrackedRows(schema, endpoint, "spieler", spieler(league));

  const parsed = schema.safeParse(emptiest(schema));
  if (parsed.success) return parsed.data;

  throw new Error(`no empty answer for ${endpoint}`);
};

/** Where a thrown redirect sends the reader, read off the digest Next's `redirect()` stamps. */
const redirectTarget = (error: unknown): string | null => {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;") ? (digest.split(";")[2] ?? null) : null;
};

/** What one page did in one league: its reads, the seasons it resolved and picked rows of, and its redirects. */
type Visit = { reads: Read[]; resolved: (string | null)[]; picks: string[]; redirects: string[] };

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
    params[name] = dynamic[1] !== undefined ? ["nirgendwo"] : name === "saison_id" ? "2026" : OBJECT_ID;
  }
  return params;
}

/** What one page does in `league`, with `searchParams` as its address's query. */
async function visit(page: string, searchParams: Record<string, string>): Promise<Visit> {
  reads.length = 0;
  resolved.length = 0;
  picks.length = 0;
  const result: Visit = { reads: [], resolved: [], picks: [], redirects: [] };
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
  result.resolved = [...resolved];
  result.picks = [...picks];
  return result;
}

/**
 * The season the admin layout's selector shows at this address, as a person reads it off the trigger;
 * `null` where it renders nothing at all.
 */
async function headerShows(searchParams: Record<string, string>): Promise<string | null> {
  const { container, unmount } = render(
    underNext((await SaisonMetadataDisplay({ tier: "admin" })) as ReactNode, { search: new URLSearchParams(searchParams) }),
  );
  const markup = container.innerHTML;
  // The trigger's first line, never its whole text, which runs straight on into the season's dates.
  const shown = /^Saison (\S+)$/.exec(container.querySelector("button span")?.textContent ?? "")?.[1] ?? null;
  unmount();

  // Its placeholder before hydration renders too, and names no season either.
  if (shown === null && markup !== "") throw new Error(`the header rendered no season: ${markup}`);
  return shown;
}

/**
 * Every published read, marked where it takes an optional `saison_id`: an omitted one is resolved to
 * the running season, which answers 404 while none runs.
 */
const OPENAPI = readPublishedDocument() as {
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

/** The pages reading the rows of every planned season beside the viewed one's, and why. */
const EVERY_PLANNED_SEASON: Record<string, string> = {
  "teams/page.tsx": "the create modal offers each planned season with its groups' fill, whichever season is viewed",
};

/** Each season one page resolved or picked a row of, other than `expected`, among the seasons `planned` names. */
function holding(page: string, { resolved: answers, picks: picked }: Visit, expected: string, planned: ReadonlySet<string>): string[] {
  const offersPlanned = EVERY_PLANNED_SEASON[label(page)] !== undefined;

  return [
    ...answers.filter((id) => id !== expected).map((id) => `${label(page)} :: resolved ${String(id)}`),
    ...picked.filter((id) => id !== expected && !(offersPlanned && planned.has(id))).map((id) => `${label(page)} :: picked a row of ${id}`),
  ];
}

const PAGES = filesUnder(APP_DIR, (name) => name === "page.tsx", 20);

/** The pages that make no read in any league, and why none is theirs to make. */
const READS_NOTHING: Record<string, string> = {
  "[...unmatched]/page.tsx": "the admin 404, answered before any read for an address no other route takes",
};
/* A `[saison_id]` segment names the page's subject, which `resolveSaisonIdParam` answers with no
   fallback, so the header's season is not the one it reads. */
const SEASON_ADDRESSED = PAGES.filter((page) => path.relative(APP_DIR, page).split(path.sep).includes("[saison_id]"));

/** The header, then every page, in one league, sequentially, since the doubles record into one list each. */
async function visitAll(
  saisons: FLSaison[],
  searchParams: Record<string, string>,
  current?: FLSaison,
): Promise<{ header: string | null; visits: Map<string, Visit>; planned: ReadonlySet<string> }> {
  league = saisons;
  cachedCurrent = current;
  const header = await headerShows(searchParams);
  const visits = new Map<string, Visit>();
  for (const page of PAGES) visits.set(page, await visit(page, searchParams));
  return { header, visits, planned: new Set(saisons.filter((entry) => entry.status === "future").map((entry) => entry.id)) };
}

/* One per state the header's selector resolves, which is what every admin page must agree with
   (`docs/frontend/spec.md :: I359`). The planned-only league is the one before a first activation,
   the only league I18 leaves without a running season. */
const RUNNING_LEAGUE = [saison("2025", "past"), saison("2026", "active"), saison("2027", "future")];
const LEAGUES = [
  { name: "a season runs", ...(await visitAll(RUNNING_LEAGUE, {})), shows: "2026" },
  { name: "the address names a planned season", ...(await visitAll(RUNNING_LEAGUE, { saison_id: "2027" })), shows: "2027" },
  { name: "no season has run yet", ...(await visitAll([saison("2026", "future"), saison("2027", "future")], {})), shows: "2026" },
  /* The cached running season still names the one before an activation a Playground paste made. */
  { name: "a season was activated outside the app", ...(await visitAll(RUNNING_LEAGUE, {}, saison("2025", "active"))), shows: "2026" },
];
const EMPTY_LEAGUE = await visitAll([], {});

describe("the season every admin page reads", () => {
  /* The control: the sweeps below see an omission, a wrong season and a picked row. A reader blind to
     any of them passes them on every page. */
  it("tells an omitted or another season, and a picked row, from the one the header shows", () => {
    const page = path.join(APP_DIR, "control", "page.tsx");

    assert.deepEqual(omitting(page, [{ endpoint: "/spiele/list/admin", params: {} }]), ["control/page.tsx :: /spiele/list/admin"]);
    assert.deepEqual(omitting(page, [{ endpoint: "/spiele/list/admin", params: { saison_id: "2026" } }]), []);
    assert.equal(naming(page, [{ endpoint: "/spiele/list/admin", params: { saison_id: "2025" } }], "2026").length, 1);

    picks.length = 0;
    const row = tracked({ saison_id: "2025", gruppe: "A" });
    assert.equal(row.saison_id, "2025");
    assert.deepEqual(picks, [], "comparing a row's season picked it");
    assert.equal(row.gruppe, "A");
    assert.deepEqual(holding(page, { reads: [], resolved: ["2026"], picks: [...picks], redirects: [] }, "2026", new Set()), [
      "control/page.tsx :: picked a row of 2025",
    ]);
  });

  for (const { name, header, visits, planned, shows } of LEAGUES) {
    it(`shows ${shows} in the header where ${name}`, () => {
      assert.equal(header, shows);
    });

    it(`reads the season the header shows where ${name}`, () => {
      const found = [...visits]
        .filter(([page]) => !SEASON_ADDRESSED.includes(page))
        .flatMap(([page, { reads: pageReads }]) => naming(page, pageReads, header ?? ""));

      assert.deepEqual(found, [], `resolve the page's season with \`resolveAdminSaison\`; the header shows ${String(header)}`);
    });

    /* A list or an editor picking its rows locally sends no season for the case above to judge. */
    it(`resolves and picks the rows of the season the header shows where ${name}`, () => {
      const found = [...visits]
        .filter(([page]) => !SEASON_ADDRESSED.includes(page))
        .flatMap(([page, entry]) => holding(page, entry, header ?? "", planned));

      assert.deepEqual(found, [], `the header shows ${String(header)}`);
    });

    /* A page redirected away makes no read for the cases above to judge, so the fallback it lost would
       pass unseen. */
    it(`sends no page away where ${name}`, () => {
      const redirects = [...visits].flatMap(([page, { redirects: targets }]) => targets.map((target) => `${label(page)} -> ${target}`));

      assert.deepEqual(redirects, []);
    });

    /* Floors: a page throwing before its first read passes the cases above having shown nothing, as
       `visit` records what it read and swallows the throw. */
    it(`reached the backend from the pages it swept where ${name}`, () => {
      const silent = [...visits]
        .filter(([page, entry]) => entry.reads.length === 0 && READS_NOTHING[label(page)] === undefined)
        .map(([page]) => label(page));
      const seasonReading = [...visits.values()].filter((entry) => entry.reads.some(({ endpoint }) => routeOf(endpoint)?.takesSaison === true));
      // A page resolving a season it then neither sends nor picks by would pass the cases above unjudged.
      const unjudged = [...visits]
        .filter(
          ([, entry]) =>
            entry.resolved.length > 0 &&
            !entry.picks.includes(shows) &&
            !entry.reads.some(({ endpoint, params }) => routeOf(endpoint)?.takesSaison === true && params.saison_id === shows),
        )
        .map(([page]) => label(page));

      assert.deepEqual(silent, [], "these pages made no read, so the cases above judged nothing of them");
      assert.ok(seasonReading.length > 0, "no page made a read taking a season, so the case above proves nothing");
      assert.deepEqual(unjudged, [], "these pages resolved a season that neither a read nor a picked row shows");
    });
  }

  /* An excuse outliving its page, or a page that reads after all, would leave a page unjudged by name. */
  it("excuses from the read floor only pages that exist and read nothing in any league", () => {
    const labels = new Set(PAGES.map(label));
    const reading = LEAGUES.flatMap(({ visits }) => [...visits].filter(([, entry]) => entry.reads.length > 0).map(([page]) => label(page)));

    assert.deepEqual(
      Object.keys(READS_NOTHING).filter((page) => !labels.has(page) || reading.includes(page)),
      [],
    );
  });

  it("shows no season in the header where the league holds none", () => {
    assert.equal(EMPTY_LEAGUE.header, null);
  });

  it("resolves no season where the league holds none", () => {
    const found = [...EMPTY_LEAGUE.visits].flatMap(([page, entry]) =>
      entry.resolved.filter((id) => id !== null).map((id) => `${label(page)} :: ${id}`),
    );

    assert.deepEqual(found, []);
  });

  /* `docs/frontend/spec.md :: I363`: an omitted season is answered with the backend's 404, which the
     page renders as its error page. */
  it("passes no omitted season to a read where the league holds none", () => {
    const found = [...EMPTY_LEAGUE.visits].flatMap(([page, { reads: pageReads }]) => omitting(page, pageReads));

    assert.deepEqual(found, [], "a page whose reads need a season takes it from `requireAdminSaison`");
  });

  it("sends the admin to the season list, and only there, where the league holds none", () => {
    const redirects = [...EMPTY_LEAGUE.visits].flatMap(([page, { redirects: targets }]) =>
      targets.map((target) => `${label(page)} -> ${target}`),
    );

    assert.ok(redirects.length > 0, "no page redirected, so the case below proves nothing");
    assert.deepEqual(
      redirects.filter((entry) => !entry.endsWith(" -> /admin/saisons")),
      [],
    );
  });
});
