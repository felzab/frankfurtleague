import "@/shared/testing/renderTest.ts";

import { registerHooks } from "node:module";
import { text } from "node:stream/consumers";

import { JSDOM } from "jsdom";
import { prerenderToNodeStream } from "react-dom/static";
import ts from "typescript";
import z from "zod";

import { APIBadStatusError, APIMalformedDataError } from "@/core/errors.ts";
import { REQUEST_PACKAGES } from "@/shared/testing/actionDoubles.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

import type { ReactElement, ReactNode } from "react";

/** One step a page took against the backend or the request, in the order it took them. */
export type PageStep = { kind: "connection" } | { kind: "read"; endpoint: string; params: Record<string, unknown> };

/** A schema as the doubled client is handed it: enough of Zod's surface to build the emptiest answer. */
export type AnswerSchema = {
  safeParse: (value: unknown) => { success: boolean; data?: unknown; error?: unknown };
  shape?: Record<string, AnswerSchema>;
  values?: Set<unknown>;
  enum?: Record<string, unknown>;
  /** Zod's own definition, which a record's key and value schemas are read off. */
  def?: { type?: string; keyType?: AnswerSchema; valueType?: AnswerSchema; options?: AnswerSchema[] };
};

/** How the doubled client answers one read. */
export type ReadAnswer = (endpoint: string, schema: AnswerSchema, params: Record<string, unknown>) => unknown;

/** What a page is handed of an answer its schema took, given the parse the client hands on. */
export type HandOver = (endpoint: string, parsed: unknown) => unknown;

// Through a global: a doubled module is compiled from source and shares nothing with this scope.
const STEPS = "__flPageSteps";

// `connection()` is where a page opts out of prerendering, so its place among the reads is recorded.
// The package is replaced whole: a module importing anything else from it fails to link here.
const PACKAGE_DOUBLES: Readonly<Record<string, string>> = {
  // Never `server-only`: this module's `data:` answer is an ES module, which Next's own CommonJS
  // `require` of it reads as a path. `renderTest.ts` resolves it to the package's empty build instead.
  ...Object.fromEntries(Object.entries(REQUEST_PACKAGES).filter(([specifier]) => specifier !== "server-only")),
  "next/server": `export const connection = async () => void globalThis.${STEPS}.push({ kind: "connection" });`,
};

const asModule = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;

/**
 * Every value a `"use client"` module exports: what a bundler hands a server tree as a client
 * reference, which React's server renderer never calls (react.dev, `'use client'`).
 */
const CLIENT_COMPONENTS = "__flClientComponents";
const clientComponents = new WeakSet<object>();
Reflect.set(globalThis, CLIENT_COMPONENTS, clientComponents);

/**
 * Whether a module's directive prologue, the string statements before any other, holds `"use client"`.
 * Read with TypeScript's scanner, which steps over comments without backtracking.
 */
export function isClientModule(source: string): boolean {
  if (!source.includes("use client")) return false;

  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  let token = scanner.scan();
  while (token === ts.SyntaxKind.StringLiteral) {
    const directive = scanner.getTokenValue();
    token = scanner.scan();
    // A string the next token continues, `"use client" + x`, is an expression rather than a directive.
    if (token !== ts.SyntaxKind.SemicolonToken && token !== ts.SyntaxKind.EndOfFileToken && !scanner.hasPrecedingLineBreak()) return false;
    if (directive === "use client") return true;
    if (token === ts.SyntaxKind.SemicolonToken) token = scanner.scan();
  }

  return false;
}

/** Appended to a client module, so each export is registered once the module has defined it. */
const registering = (url: string): string =>
  `\nimport * as __flSelf from ${JSON.stringify(url)};\nfor (const value of Object.values(__flSelf)) if (typeof value === "function") globalThis.${CLIENT_COMPONENTS}.add(value);\n`;

/**
 * ES modules alone: an `import` appended to a CommonJS one makes Node read it as an ES module. A
 * CommonJS client component is therefore called, and the walk reports its hooks' throw.
 */
const ES_MODULE = new Set(["module", "module-typescript"]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
  },
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (loaded.source === undefined || loaded.source === null || !ES_MODULE.has(loaded.format ?? "")) return loaded;
    const source = typeof loaded.source === "string" ? loaded.source : new TextDecoder().decode(loaded.source);
    return isClientModule(source) ? { ...loaded, source: source + registering(url) } : loaded;
  },
});

const globals = globalThis as unknown as Record<string, unknown>;

/** Every step since the last `clearSteps`, across every page the process renders or calls. */
export const steps: PageStep[] = [];
globals[STEPS] = steps;

export function clearSteps(): void {
  steps.length = 0;
}

/** The reads among `steps`, in order. */
export const readsOf = (taken: readonly PageStep[]): { endpoint: string; params: Record<string, unknown> }[] =>
  taken.flatMap((step) => (step.kind === "read" ? [{ endpoint: step.endpoint, params: step.params }] : []));

/** The id every single-document read is answered with, shaped as the backend's ids are. */
export const OBJECT_ID = "6890a1b2c3d4e5f607250001";

/**
 * A season's id, status and rules, which no empty value satisfies. Spelled structurally, as `shared`
 * imports no slice's schema: the caller parses it through
 * `fl_frontend/src/features/saisons/schemas.ts :: FLSaisonSchema`, which refuses the drift.
 */
export function saisonFields(id: string, status: "past" | "active" | "future"): Record<string, unknown> {
  return {
    id: id,
    status: status,
    rules: {
      win_points: 3,
      draw_points: 1,
      qualifiers_per_group: 2,
      number_of_groups: 2,
      teams_per_group: 4,
      max_kadergroesse: 18,
      tiebreak_order: "tordifferenz",
      forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
      erlaubte_stufen: ["E1", "Q1"],
    },
  };
}

/**
 * Tried in order: a list read with nothing in it lets the page read on. The last four stand in where a
 * schema refuses an empty value: a season, an id, a date, a count.
 */
const EMPTIES: unknown[] = [[], null, 0, "", false, "2026", OBJECT_ID, "2026-01-01", 1];

/**
 * The emptiest value a schema takes: a literal's or an enum's first member, an object's fields each
 * emptied, a union's first member that answers, and a record holding every key Zod demands of it.
 */
export function emptiest(schema: AnswerSchema): unknown {
  const { type, keyType, valueType, options } = schema.def ?? {};
  const candidates = [
    ...(schema.values ?? []),
    ...Object.values(schema.enum ?? {}),
    ...EMPTIES,
    ...(schema.shape === undefined ? [] : [Object.fromEntries(Object.entries(schema.shape).map(([key, field]) => [key, emptiest(field)]))]),
    ...(type === "union" ? (options ?? []).map(emptiest) : []),
    // Keyed by an enum, a record demands every member; keyed by a string, it takes none.
    ...(type === "record" ? [Object.fromEntries(Object.values(keyType?.enum ?? {}).map((key) => [key, emptiest(valueType!)]))] : []),
  ];
  return candidates.find((candidate) => schema.safeParse(candidate).success);
}

/** A response the schema takes, carrying `fields` over the emptiest one it accepts. */
export function answer(schema: AnswerSchema, endpoint: string, fields: Record<string, unknown>): unknown {
  // Field by field: a body whose `fields` no empty value could stand in for has no emptiest whole.
  const body = Object.fromEntries(
    Object.entries(schema.shape ?? {}).map(([key, field]) => [key, key in fields ? fields[key] : emptiest(field)]),
  );
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error(`no answer for ${endpoint}`);
  return parsed.data;
}

/** Every read answered with the emptiest body its schema takes; a schema no empty satisfies refuses the read. */
export const EMPTIEST_ANSWER: ReadAnswer = (endpoint, schema) => {
  const parsed = schema.safeParse(emptiest(schema));
  if (parsed.success) return parsed.data;
  throw new Error(`no empty answer for ${endpoint}`);
};

const backendUrl = (endpoint: string): string => `http://backend/api/v0${endpoint}`;

/** The backend's 404 for `endpoint`, which a query reading "none" off it turns into its `null`. */
export const backendNotFound = (endpoint: string): APIBadStatusError =>
  new APIBadStatusError({
    message: "not found",
    url: backendUrl(endpoint),
    statusCode: 404,
    serverErrorCode: "DB-COMMON-001",
    endpoint: endpoint,
    method: "GET",
    readOnly: true,
    traceId: "0",
  });

const asParsed: HandOver = (_endpoint, parsed) => parsed;
let handOver: HandOver = asParsed;
let answerRead: ReadAnswer = EMPTIEST_ANSWER;

/**
 * Answers every read from here on with `respond`, until another call names another. `handingOver`
 * sees each answer only once the client's check has parsed it, so what it wraps is never read there.
 */
export function answerReadsWith(respond: ReadAnswer, handingOver: HandOver = asParsed): void {
  answerRead = respond;
  handOver = handingOver;
}

doubleApiClient(async ({ endpoint, method, params, readOnly }, handedSchema) => {
  const schema = handedSchema as z.ZodType & AnswerSchema;
  const asked = (params ?? {}) as Record<string, unknown>;
  steps.push({ kind: "read", endpoint, params: asked });
  const body = await answerRead(endpoint, schema, asked);

  // The client's own check (`fl_frontend/src/core/api.ts :: apiClient`): a body its schema refuses
  // rejects, and a page is handed the parse, never the body an answer built.
  const parsed = schema.safeParse(body);
  if (parsed.success) return handOver(endpoint, parsed.data);
  throw new APIMalformedDataError({
    message: "API returned malformed data.",
    url: backendUrl(endpoint),
    statusCode: 200,
    endpoint: endpoint,
    method: (method ?? "GET").toUpperCase(),
    readOnly: readOnly === true,
    traceId: "0",
    zodIssues: z.treeifyError(parsed.error),
  });
});

/** Where a thrown redirect sends the reader, read off the digest Next's `redirect()` stamps. */
export const redirectTarget = (error: unknown): string | null => {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && digest.startsWith("NEXT_REDIRECT;") ? (digest.split(";")[2] ?? null) : null;
};

/** Whether a throw is Next's own answer for the address — a redirect or a 404 — rather than a crash. */
export const isNavigation = (error: unknown): boolean => {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === "string" && (digest.startsWith("NEXT_REDIRECT;") || digest === "NEXT_HTTP_ERROR_FALLBACK;404");
};

/** What walking one tree met: every throw, and every read made before any `connection()` above it. */
export type Walk = { thrown: unknown[]; unconnected: string[] };

const isAsync = (type: unknown): type is (props: unknown) => Promise<unknown> =>
  typeof type === "function" && type.constructor.name === "AsyncFunction";

/** A function component outside every `"use client"` module, which is a class of none. */
const isServerComponent = (type: unknown): type is (props: unknown) => unknown =>
  typeof type === "function" &&
  !clientComponents.has(type) &&
  !(type.prototype as { isReactComponent?: unknown } | undefined)?.isReactComponent;

/** A server component's element: its type is what the walk calls. */
type ServerElement = { type: (props: unknown) => unknown; props: Record<string, unknown> };

/** What entering a server component gives the walk: what it returned, walked on under `context`, or the walk's end. */
type Entered<C> = { returned: unknown; context: C } | "stop";

/** What a walk does at a server component, and at a promise the tree holds that rejects. */
type Visitor<C> = { enter: (element: ServerElement, context: C) => Promise<Entered<C>>; rejected: (error: unknown) => void };

/**
 * Resolves a tree as React's server renderer does, the one rule `callPage` and `pageBody` share;
 * answers whether `enter` stopped the walk.
 */
async function resolveTree<C>(node: unknown, context: C, visitor: Visitor<C>, depth = 0): Promise<boolean> {
  if (depth > 60 || node === null || typeof node !== "object") return false;
  if (Array.isArray(node)) {
    for (const child of node) if (await resolveTree(child, context, visitor, depth + 1)) return true;
    return false;
  }
  if (node instanceof Promise) return resolveTree(await node.catch(visitor.rejected), context, visitor, depth + 1);

  const element = node as Partial<ReactElement<Record<string, unknown>>>;
  if (element.props === undefined) return false;

  // As React's server renderer does: every function component but a client one is called, and a
  // promise it returns awaited (`react-server-dom-webpack-server :: renderElement`).
  if (!isServerComponent(element.type)) {
    for (const value of Object.values(element.props)) if (await resolveTree(value, context, visitor, depth + 1)) return true;
    return false;
  }
  // Its props are not walked: they reach the page only through what it returns, and walked here too,
  // every child it renders would be called twice.
  const entered = await visitor.enter({ type: element.type, props: element.props }, context);
  return entered === "stop" || resolveTree(entered.returned, entered.context, visitor, depth + 1);
}

/** The props Next hands a page. */
export type PageProps = { params: Promise<Record<string, unknown>>; searchParams: Promise<Record<string, string | string[]>> };

/**
 * Calls a page and every component its tree reaches, awaiting the async ones, so each read it makes
 * is made; every throw is recorded and the walk goes on past it.
 */
export async function callPage<P>(Page: (props: P) => unknown, props: P): Promise<Walk> {
  const walk: Walk = { thrown: [], unconnected: [] };
  // `connected`: whether a component above has already awaited `connection()`.
  const enter = async (element: ServerElement, connected: boolean): Promise<Entered<boolean>> => {
    const from = steps.length;
    let returned: unknown;
    try {
      returned = await element.type(element.props);
    } catch (error) {
      walk.thrown.push(error);
    }
    // Its own steps alone: its children are called after it returns, so theirs land after this slice.
    let own = connected;
    for (const step of steps.slice(from)) {
      if (step.kind === "connection") own = true;
      else if (!own) walk.unconnected.push(`${element.type.name} :: ${step.endpoint}`);
    }
    return { returned: returned, context: own };
  };
  await resolveTree({ type: Page, props }, false, { enter: enter, rejected: (error) => void walk.thrown.push(error) });
  return walk;
}

/**
 * React's markup spelled as `renderPage` spells its answer: the DOM writes a no-break space as
 * `&nbsp;` where React writes the character, so a fragment React rendered is found there only once
 * it has passed through here too.
 */
export function asRenderedPage(markup: string): string {
  const { window } = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`);
  try {
    return window.document.body.innerHTML;
  } finally {
    window.close();
  }
}

/** A boundary the stream sent as its fallback, React's script still to swap its content in. */
const UNREVEALED = 'template[id^="B:"]';

/** Frames a stream's reveal may take before the page is called stuck rather than slow. */
const REVEAL_FRAMES = 60;

/**
 * React's server renderer restores a provider's value only when a render re-enters it, so the page's
 * last provider stays set for a later client render in this process. An empty render pops back to its
 * root and does nothing else.
 */
async function popProviders(): Promise<void> {
  const { prelude } = await prerenderToNodeStream(null);
  await text(prelude);
}

/**
 * The document a browser holds once the page's stream has run, every boundary awaited, as
 * `fl_frontend/src/shared/testing/renderTest.ts :: renderMarkup` does not.
 */
export async function renderPage(tree: ReactNode): Promise<string> {
  const errors: unknown[] = [];
  let markup: string;
  try {
    const { prelude } = await prerenderToNodeStream(tree, { onError: (error) => void errors.push(error) });
    markup = await text(prelude);
  } finally {
    await popProviders();
  }
  // React answers a throw inside a boundary with its fallback, so an absence asserted over that markup
  // would pass over a crash.
  if (errors.length > 0) throw errors.length === 1 ? errors[0] : new AggregateError(errors, "the page's render reported errors");

  // A boundary still pending when the shell was written streams as its fallback beside the content and
  // React's script swapping them, so the markup holds both until that script runs, as it does here.
  const { window } = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, { runScripts: "dangerously", pretendToBeVisual: true });
  try {
    for (let frame = 0; window.document.querySelector(UNREVEALED) !== null; frame += 1) {
      if (frame === REVEAL_FRAMES) throw new Error(`the page's stream revealed no content in ${String(REVEAL_FRAMES)} frames`);
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    }
    for (const script of window.document.querySelectorAll("script")) script.remove();
    return window.document.body.innerHTML;
  } finally {
    window.close();
  }
}

/**
 * A synchronous page's body: what the first async server component its tree reaches returns, found
 * as `callPage` walks, so a case reads the props it hands its view or renders them under Testing
 * Library.
 */
export async function pageBody<P>(Page: (props: P) => unknown, props: P): Promise<ReactElement> {
  const found: ReactElement[] = [];
  const enter = async (element: ServerElement): Promise<Entered<undefined>> => {
    if (!isAsync(element.type)) return { returned: element.type(element.props), context: undefined };
    found.push((await element.type(element.props)) as ReactElement);
    return "stop";
  };
  // Recorded by no walk, unlike `callPage`'s: a throw on the way to the body reaches the case.
  const rejected = (error: unknown): never => {
    throw error;
  };
  await resolveTree({ type: Page, props }, undefined, { enter: enter, rejected: rejected });
  if (found[0] === undefined) throw new Error(`${Page.name} reaches no async component to call`);
  return found[0];
}
