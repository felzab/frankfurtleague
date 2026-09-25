import "@/shared/testing/renderTest.ts";

import { registerHooks } from "node:module";
import { text } from "node:stream/consumers";

import { JSDOM } from "jsdom";
import { prerenderToNodeStream } from "react-dom/static";

import { APIBadStatusError } from "@/core/errors.ts";
import { REQUEST_PACKAGES } from "@/shared/testing/actionDoubles.ts";

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

// Through globals: a doubled module is compiled from source and shares nothing with this scope.
const STEPS = "__flPageSteps";
const ANSWER = "__flPageAnswer";

const API_DOUBLE = `export const apiClient = async (endpoint, schema, options = {}) => {
  const params = options.params ?? {};
  globalThis.${STEPS}.push({ kind: "read", endpoint, params });
  return globalThis.${ANSWER}(endpoint, schema, params);
};`;

// `connection()` is where a page opts out of prerendering, so its place among the reads is recorded.
// The package is replaced whole: a module importing anything else from it fails to link here.
const PACKAGE_DOUBLES: Readonly<Record<string, string>> = {
  ...REQUEST_PACKAGES,
  "next/server": `export const connection = async () => void globalThis.${STEPS}.push({ kind: "connection" });`,
};

const asModule = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;

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

/** The backend's 404 for `endpoint`, which a query reading "none" off it turns into its `null`. */
export const backendNotFound = (endpoint: string): APIBadStatusError =>
  new APIBadStatusError({
    message: "not found",
    url: `http://backend/api/v0${endpoint}`,
    statusCode: 404,
    serverErrorCode: "DB-NOTFOUND-001",
    endpoint: endpoint,
    method: "GET",
    readOnly: true,
    traceId: "0",
  });

/** Answers every read from here on with `respond`, until another call names another. */
export function answerReadsWith(respond: ReadAnswer): void {
  globals[ANSWER] = respond;
}
answerReadsWith(EMPTIEST_ANSWER);

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

/**
 * Calls every component a tree reaches, awaiting the async ones, so each read it makes is made; every
 * throw is recorded and the walk goes on past it. `connected` is whether a component above has
 * already awaited `connection()`.
 */
async function reach(node: unknown, walk: Walk, connected = false, depth = 0): Promise<void> {
  if (depth > 60 || node === null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) await reach(child, walk, connected, depth + 1);
    return;
  }
  if (node instanceof Promise) {
    await reach(await node.catch((error: unknown) => void walk.thrown.push(error)), walk, connected, depth + 1);
    return;
  }

  const element = node as Partial<ReactElement<Record<string, unknown>>>;
  if (element.props === undefined) return;

  for (const value of Object.values(element.props)) await reach(value, walk, connected, depth + 1);

  // Async ones alone: a server component that reads is async, and calling a client component outside
  // a render trips its hooks. A sync server component's children are reached through its props above.
  if (!isAsync(element.type)) return;

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
  await reach(returned, walk, own, depth + 1);
}

/** The props Next hands a page. */
export type PageProps = { params: Promise<Record<string, unknown>>; searchParams: Promise<Record<string, string | string[]>> };

/** Calls a page and everything its tree reaches, as `reach` does, a synchronous page's own throw recorded too. */
export async function callPage(Page: (props: PageProps) => unknown, props: PageProps): Promise<Walk> {
  const walk: Walk = { thrown: [], unconnected: [] };
  try {
    await reach(isAsync(Page) ? { type: Page, props } : Page(props), walk);
  } catch (error) {
    walk.thrown.push(error);
  }
  return walk;
}

/** A boundary the stream sent as its fallback, React's script still to swap its content in. */
const UNREVEALED = 'template[id^="B:"]';

/** Frames a stream's reveal may take before the page is called stuck rather than slow. */
const REVEAL_FRAMES = 60;

/**
 * The document a browser holds once the page's stream has run, every boundary awaited, as
 * `fl_frontend/src/shared/testing/renderTest.ts :: renderMarkup` does not.
 */
export async function renderPage(tree: ReactNode): Promise<string> {
  const errors: unknown[] = [];
  const { prelude } = await prerenderToNodeStream(tree, { onError: (error) => void errors.push(error) });
  const markup = await text(prelude);
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

/** The first async component under `node`'s children, depth first. */
function firstAsync(node: unknown): { type: (props: unknown) => Promise<unknown>; props: unknown } | null {
  const element = node as Partial<ReactElement<{ children?: unknown }>> | null;
  if (element === null || typeof element !== "object") return null;
  if (Array.isArray(element)) return element.map(firstAsync).find((found) => found !== null) ?? null;
  if (isAsync(element.type)) return { type: element.type, props: element.props };
  return firstAsync(element.props?.children);
}

/**
 * A synchronous page's body: the first async component its tree holds, called as the component it is,
 * so a case reads the props it hands its view or renders them under Testing Library.
 */
export async function pageBody<P>(Page: (props: P) => unknown, props: P): Promise<ReactElement> {
  const body = firstAsync(Page(props));
  if (body === null) throw new Error(`${Page.name} returns no async component to call`);
  return (await body.type(body.props)) as ReactElement;
}
