import "@/shared/testing/renderTest.ts";

import { registerHooks } from "node:module";
import { text } from "node:stream/consumers";

import { cloneElement, createElement, Fragment, isValidElement } from "react";

import { JSDOM } from "jsdom";
import { prerenderToNodeStream } from "react-dom/static";
import z from "zod";

import { APIBadStatusError, APIMalformedDataError, APINetworkError } from "@/core/errors.ts";
import { exportingModule, registerDoubles } from "@/core/exportingModule.ts";
import { formatTraceparent, TRACEPARENT_HEADER } from "@/core/trace.ts";
import { hasDirective } from "@/core/treeWalk.ts";
import { incomingHeaders, REQUEST_PACKAGES } from "@/shared/testing/actionDoubles.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";
import { saisonRules } from "@/shared/testing/saisonRules.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";
import type { ReactElement, ReactNode } from "react";

/** The trace the edge opens for every page request this harness serves, as nginx stamps one on each. */
export const EDGE_TRACE_ID = "0af7651916cd43dd8448eb211c80319c";
incomingHeaders.set(TRACEPARENT_HEADER, formatTraceparent({ traceId: EDGE_TRACE_ID, spanId: "b7ad6b7169203331" }));

/** One step a page took against the backend or the request, in the order it took them. */
export type PageStep =
  | { kind: "connection" }
  // `body` parsed, for a read sent as a POST: what it asks about rides there rather than in `params`.
  | { kind: "read"; endpoint: string; params: Record<string, unknown>; body: unknown; authType: ApiCall["authType"] };

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

// The request every page renders in, each page reaching what its own reads and guard call; every page
// reaches `next/server`, which is held.
registerDoubles(
  {
    specifiers: {
      ...REQUEST_PACKAGES,
      // `connection()` is where a page opts out of prerendering, so its place among the reads is recorded.
      "next/server": {
        connection: () => {
          steps.push({ kind: "connection" });
          // Never settling inside `prerenderShell`, as the build's own prerender holds it.
          return holdsConnection ? new Promise<void>(() => undefined) : Promise.resolve();
        },
      },
    },
  },
  { mayGoUnserved: Object.keys(REQUEST_PACKAGES) },
);

const asModule = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;

/**
 * Every value a `"use client"` module exports: what a bundler hands a server tree as a client
 * reference, which React's server renderer never calls (react.dev, `'use client'`).
 */
const clientComponents = new WeakSet<object>();

/** The specifier a client module imports its registration by, answered with the module below. */
const REGISTER = "fl-page-harness:register";
const REGISTER_MODULE = asModule(
  exportingModule({
    registerClientExports: (exported: Readonly<Record<string, unknown>>) => {
      for (const value of Object.values(exported)) if (typeof value === "function") clientComponents.add(value);
    },
  }),
);

/** Whether a module's directive prologue holds `"use client"`, by the one prologue reader the server actions' sweep reads too. */
export function isClientModule(source: string): boolean {
  return hasDirective(source, "use client");
}

/**
 * The specifier a client module imports itself by, which the resolve hook answers with the importer's
 * own URL: spelled into the source, a URL is code wherever an escape it passed through fails.
 */
const SELF = "fl-page-harness:self";

/** Appended to a client module, so each export is registered once the module has defined it. */
const REGISTERING = `\nimport * as __flSelf from "${SELF}";\nimport { registerClientExports as __flRegister } from "${REGISTER}";\n__flRegister(__flSelf);\n`;

/**
 * ES modules alone: an `import` appended to a CommonJS one makes Node read it as an ES module. A
 * CommonJS client component is therefore called, and the walk reports its hooks' throw.
 */
const ES_MODULE = new Set(["module", "module-typescript"]);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === SELF && context.parentURL !== undefined) return { url: context.parentURL, shortCircuit: true };
    if (specifier === REGISTER) return { url: REGISTER_MODULE, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    if (loaded.source === undefined || loaded.source === null || !ES_MODULE.has(loaded.format ?? "")) return loaded;
    const source = typeof loaded.source === "string" ? loaded.source : new TextDecoder().decode(loaded.source);
    return isClientModule(source) ? { ...loaded, source: source + REGISTERING } : loaded;
  },
});

/** Every step since the last `clearSteps`, across every page the process renders or calls. */
export const steps: PageStep[] = [];

/** Set while `prerenderShell` runs, so a `connection()` never settles. */
let holdsConnection = false;

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
    rules: saisonRules(),
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

/**
 * A read of `endpoint` the network never answered, as the API client raises it in production: a page's degraded
 * read settles it to its panel with no line, where a bare `TypeError` stands for a bug and is logged.
 */
export const backendUnreachable = (endpoint: string, method = "GET"): APINetworkError =>
  new APINetworkError({
    message: "Network request failed. Please check your connection.",
    url: backendUrl(endpoint),
    method: method,
    readOnly: true,
    traceId: "0",
    isTimeout: false,
    originalError: new TypeError("fetch failed"),
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

doubleApiClient(async ({ endpoint, method, params, body: sent, readOnly, authType }, handedSchema) => {
  const schema = handedSchema as z.ZodType & AnswerSchema;
  const asked = (params ?? {}) as Record<string, unknown>;
  steps.push({ kind: "read", endpoint, params: asked, body: sent === undefined ? undefined : (JSON.parse(sent) as unknown), authType });
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
 * The static shell the build prerenders, the prelude served before the request is read: `connection()`
 * never settles, so whatever awaits it stands as its boundary's fallback. Aborted once the work it does
 * not hold has run.
 */
export async function prerenderShell(tree: ReactNode): Promise<string> {
  const errors: unknown[] = [];
  const controller = new AbortController();
  holdsConnection = true;
  let markup: string;
  try {
    // A macrotask: every microtask a resolved read chains has run by then, so nothing short of the request is cut.
    setImmediate(() => controller.abort());
    const { prelude } = await prerenderToNodeStream(tree, {
      signal: controller.signal,
      onError: (error) => void (controller.signal.aborted ? undefined : errors.push(error)),
    });
    markup = await text(prelude);
  } finally {
    holdsConnection = false;
    await popProviders();
  }
  if (errors.length > 0) throw errors.length === 1 ? errors[0] : new AggregateError(errors, "the shell's prerender reported errors");
  // A boundary completed after the shell was written arrives beside its fallback with React's script swapping
  // it in; one still held keeps its fallback, any part already rendered hidden for the resume, as the browser shows it.
  const completed = [...markup.matchAll(/\$RC\("B:\w+","(S:\w+)"\)/g)].map(([, segment]) => `[id="${segment!}"]`);
  const { window } = new JSDOM(`<!doctype html><html><body>${markup}</body></html>`, { runScripts: "dangerously", pretendToBeVisual: true });
  try {
    for (let frame = 0; completed.some((segment) => window.document.querySelector(segment) !== null); frame += 1) {
      if (frame === REVEAL_FRAMES) throw new Error(`the shell's stream revealed no completed boundary in ${String(REVEAL_FRAMES)} frames`);
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    }
    for (const hidden of window.document.querySelectorAll('script, div[hidden][id^="S:"]')) hidden.remove();
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

/**
 * As the server renderer hands a tree on: a server component called and awaited, every other element
 * kept with its props resolved alike, and a client element's promise left a promise, as the wire
 * carries one.
 */
async function resolvedNode(node: unknown, depth: number): Promise<unknown> {
  if (depth > 60 || node === null || typeof node !== "object") return node;
  if (Array.isArray(node)) {
    const children: unknown[] = [];
    for (const child of node) children.push(await resolvedNode(child, depth + 1));
    // The very array wherever nothing in it changed: React judges a list's keys by what it was built as.
    return children.every((child, index) => child === node[index]) ? node : children;
  }
  if (node instanceof Promise) return resolvedNode(await node, depth + 1);
  if (!isValidElement<Record<string, unknown>>(node)) return node;

  if (isServerComponent(node.type)) {
    const returned = await resolvedNode(await node.type(node.props), depth + 1);
    // Keyed as the element it stands for, which a list's siblings are told apart by.
    return node.key === null ? returned : createElement(Fragment, { key: node.key }, returned as ReactNode);
  }
  const props: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(node.props)) {
    props[name] = value instanceof Promise ? Promise.resolve(await resolvedNode(await value, depth + 1)) : await resolvedNode(value, depth + 1);
  }
  // The very element wherever nothing under it changed, for the array's reason above.
  if (Object.entries(props).every(([name, value]) => value === node.props[name])) return node;
  const { children, ...rest } = props;
  // Spread, as JSX hands several children, where the element was built with them.
  const clone =
    Array.isArray(children) && children !== node.props.children && Array.isArray(node.props.children)
      ? cloneElement(node, rest, ...(children as ReactNode[]))
      : cloneElement(node, props);
  // A clone starts without the development mark that its key was checked, which React's Flight server carries with the
  // element (`renderElement`, Next's bundled copy, read 2026-10-16, moving without us): unmarked, it reads as an
  // unkeyed child of its static list.
  const store = (clone as { _store?: { validated?: number } })._store;
  if (store !== undefined) store.validated = (node as { _store?: { validated?: number } })._store?.validated;
  return clone;
}

/**
 * A page's whole tree with its client elements kept, for a case typing into what the page shows:
 * `pageBody` stops at the first async component and drops the rest. A redirect thrown on the way
 * reaches the case.
 */
export async function resolvedPage<P>(Page: (props: P) => unknown, props: P): Promise<ReactNode> {
  return (await resolvedNode(await Page(props), 0)) as ReactNode;
}
