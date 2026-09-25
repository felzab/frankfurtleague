import "./dom.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createContext, createElement as h, Suspense, useContext } from "react";

import { render } from "@testing-library/react";
import z from "zod";

import { APIMalformedDataError } from "@/core/errors.ts";

import {
  answerReadsWith,
  asRenderedPage,
  callPage,
  clearSteps,
  emptiest,
  EMPTIEST_ANSWER,
  isNavigation,
  OBJECT_ID,
  pageBody,
  readsOf,
  renderPage,
  steps,
} from "./pageHarness.ts";
import { renderTree } from "./renderTest.ts";

import type { ReactElement } from "react";

const textOf = (body: ReactElement): unknown => (body as ReactElement<{ children: unknown }>).props.children;

/* `await import`, never a static import: the doubles are registered as the harness evaluates, and a
   static import would have resolved the real modules before then. */
const { connection } = await import("next/server");
const { apiClient } = await import("@/core/api.ts");
const { notFound } = await import("next/navigation.js");
const { Button } = await import("@heroui/react/button");
const { AdminCrudSearch } = await import("@/shared/components/ui/AdminCrudSearch.tsx");

const Answer = z.object({ n: z.number() });
const PROPS = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

async function Connected() {
  await connection();
  await apiClient("/erst-nach-connection", Answer);
  return h(ReadsUnderIt);
}

/* Awaits no connection of its own: it is called only once its parent has returned. */
async function ReadsUnderIt() {
  await apiClient("/im-kind", Answer);
  return h("p", null, "geladen");
}

async function ReadsFirst() {
  await apiClient("/vor-connection", Answer);
  await connection();
  return null;
}

async function Crashes(): Promise<never> {
  await connection();
  throw new Error("kaputt");
}

async function Missing() {
  await connection();
  return notFound();
}

const inBoundary = (child: ReturnType<typeof h>) => () => h(Suspense, { fallback: h("p", null, "lädt") }, child);

describe("the page harness", () => {
  /* A page rendered under a provider would otherwise leave that provider's value in place of the
     context's default for every client render after it in the same file. */
  it("leaves no provider's value set for a client render after it", async () => {
    const Kontext = createContext("leer");
    const Reads = () => h("span", null, useContext(Kontext));
    async function Late() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return h("p", null, "spät geladen");
    }

    await renderPage(h(Kontext.Provider, { value: "gesetzt" }, h(Suspense, { fallback: null }, h(Late), h(Reads))));
    const { container, unmount } = render(h(Reads));

    assert.equal(container.textContent, "leer", "the page's provider still answers a client render outside it");
    unmount();
  });

  it("renders an async body inside its boundary to what it resolves to, not to the fallback", async () => {
    const markup = await renderPage(h(inBoundary(h(Connected))));

    assert.match(markup, /geladen/);
    assert.doesNotMatch(markup, /lädt/, "the render stopped at the boundary's fallback");
  });

  /* A boundary React outlines, as it does a large one beside another, streams as its fallback beside
     the content and a script swapping them in on a later frame: the markup before that holds both. */
  it("hands back the document once the stream has swapped a late body in", async () => {
    async function Late() {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return h("p", null, `spät geladen ${"x".repeat(20_000)}`);
    }
    const boundary = (fallback: string) => h(Suspense, { fallback: h("p", null, fallback) }, h(Late));
    const markup = await renderPage(h("div", null, boundary("lädt eins"), boundary("lädt zwei")));

    assert.match(markup, /spät geladen/);
    assert.doesNotMatch(markup, /lädt/, "a boundary's fallback stands beside the content it was swapped for");
  });

  /* React answers a throw inside a boundary with the fallback and a client-rendering template, so a
     render that resolved there would hand an absence assertion a crash to pass over. */
  it("rejects where a body throws inside its boundary", async () => {
    await assert.rejects(renderPage(h(inBoundary(h(Crashes)))), /kaputt/);
  });

  it("records each step in order, and a read no connection() above it opened", async () => {
    clearSteps();
    const walk = await callPage(inBoundary(h("div", null, h(Connected), h(ReadsFirst))), PROPS);

    assert.deepEqual(
      steps.map((step) => (step.kind === "read" ? step.endpoint : step.kind)),
      ["connection", "/erst-nach-connection", "/im-kind", "/vor-connection", "connection"],
    );
    assert.deepEqual(
      walk.unconnected,
      ["ReadsFirst :: /vor-connection"],
      "a child is charged for its parent's connection, or a read before one passes",
    );
  });

  /* A server component need not be async: one returning an async one is how a loader gets wrapped, and
     skipped, the loader's reads went unjudged by every case the walk feeds. */
  it("calls a synchronous server component and reaches what it returns", async () => {
    const Wraps = () => h(ReadsFirst);

    clearSteps();
    const walk = await callPage(inBoundary(h(Wraps)), PROPS);

    assert.deepEqual(walk.unconnected, ["ReadsFirst :: /vor-connection"], "the loader behind the wrapper was never called");
  });

  /* A shell handed its list as a child is how an admin page is built: a read counted once per call
     lets a case pin a page to exactly the reads it makes. */
  it("calls a server component's child once, through what the component returns", async () => {
    const Holds = ({ children }: { children: ReturnType<typeof h> }) => h("section", null, children);

    clearSteps();
    await callPage(inBoundary(h(Holds, null, h(ReadsUnderIt))), PROPS);

    assert.deepEqual(readsOf(steps), [{ endpoint: "/im-kind", params: {} }], "the child was called beside its parent as well as through it");
  });

  /* A client component is a client reference to a server tree, never called there; called here, its
     hooks would throw with no render to answer them. Both kinds a page holds: the app's own, and a
     package's. */
  it("calls no component a `use client` module exports", async () => {
    clearSteps();
    const walk = await callPage(
      inBoundary(h("div", null, h(AdminCrudSearch, { searchLabel: "Suchen", searchPlaceholder: "" }), h(Button, null, h(Connected)))),
      PROPS,
    );

    assert.deepEqual(walk.thrown, [], "a client component was called outside a render");
    assert.ok(
      steps.some((step) => step.kind === "read" && step.endpoint === "/im-kind"),
      "the server child a client component holds was not reached",
    );
  });

  it("records every throw and walks on past it, telling Next's own answers from a crash", async () => {
    clearSteps();
    const walk = await callPage(inBoundary(h("div", null, h(Crashes), h(Missing), h(Connected))), PROPS);

    assert.deepEqual(
      walk.thrown.map((error) => [error instanceof Error ? error.message : String(error), isNavigation(error)]),
      [
        ["kaputt", false],
        ["NEXT_HTTP_ERROR_FALLBACK;404", true],
      ],
    );
    assert.ok(
      steps.some((step) => step.kind === "read" && step.endpoint === "/im-kind"),
      "the walk stopped at the first throw",
    );
  });

  /* The DOM writes the answer back out and React wrote the fragment, and the two spell a no-break space
     differently: compared raw, a fragment on the page reads as absent. */
  it("spells a fragment React rendered as it spells its own answer", async () => {
    const tree = h("p", null, "Saison\u00a02026");
    const page = await renderPage(tree);

    assert.ok(!page.includes(renderTree(tree)), "the two spell alike, so the helper below is proven over nothing");
    assert.ok(page.includes(asRenderedPage(renderTree(tree))));
  });

  /* The body is found by the walk's own rule: a synchronous wrapper around it is called, as React
     calls it, rather than searched for a child it only returns. */
  it("finds a page's body behind a synchronous wrapper", async () => {
    async function Body() {
      await connection();
      return h("p", null, "Rumpf");
    }
    const Wraps = () => h(Suspense, { fallback: null }, h(Body));

    const body = await pageBody(() => h("main", null, h(Wraps)), PROPS);

    assert.equal(textOf(body), "Rumpf");
  });

  it("calls no component a `use client` module exports on the way to the body", async () => {
    const body = await pageBody(() => h(Button, null, h(ReadsUnderIt)), PROPS);

    assert.equal(textOf(body), "geladen");
  });

  /* An answer the client would refuse lets a page pass on data production never hands it. */
  it("rejects a read whose answer its schema refuses, as the client does", async () => {
    answerReadsWith(() => ({ n: "eins" }));
    try {
      await assert.rejects(
        apiClient("/falsch", Answer),
        (error) => error instanceof APIMalformedDataError && error.endpoint === "/falsch",
        "an answer the schema refuses reached the page",
      );
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });

  /* The client hands on its parse: a page given the answer's own object sees fields production strips,
     and a tracker on it has already recorded every field the check read. */
  it("hands the page, and the hand-over before it, the parse rather than the answer's own body", async () => {
    const built = { n: 1, fremd: true };
    const seen: unknown[] = [];
    answerReadsWith(
      () => built,
      (_endpoint, parsed) => {
        seen.push(parsed);
        return parsed;
      },
    );
    try {
      assert.deepEqual(await apiClient("/geparst", Answer), { n: 1 }, "the page was handed the body the answer built");
      assert.notEqual(seen[0], built, "the hand-over was given the answer's own object, which the check had read");
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });

  it("answers the schemas a read refuses an empty value for", () => {
    const Schema = z.object({
      id: z.string().regex(/^[0-9a-f]{24}$/),
      saison_id: z.string().length(4),
      am: z.iso.date(),
      je_status: z.record(z.enum(["offen", "zu"]), z.int().nonnegative()),
      je_name: z.record(z.string(), z.int()),
      format: z.discriminatedUnion("format", [z.object({ format: z.literal("liste") }), z.object({ format: z.literal("gruppen") })]),
      position: z.int().min(1),
    });

    assert.deepEqual(emptiest(Schema), {
      id: OBJECT_ID,
      saison_id: "2026",
      am: "2026-01-01",
      je_status: { offen: 0, zu: 0 },
      je_name: {},
      format: { format: "liste" },
      position: 1,
    });
  });
});
