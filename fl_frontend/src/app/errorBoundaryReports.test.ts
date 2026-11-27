// @vitest-environment jsdom
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { act, cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy/shared";
import { serveBackend, serveHost } from "@/test-support/backend";
import { renderUnderNext } from "@/test-support/nextContexts";
import { filesUnder } from "@/test-support/treeWalk";

import type { ComponentType } from "react";

const APP_DIR = import.meta.dirname;

/* Next's own file convention decides this listing, so a segment given a boundary tomorrow is swept
   with no edit here. `global-error.tsx` too: it replaces the root boundary rather than joining it. */
const BOUNDARIES = filesUnder(APP_DIR, (name) => name === "error.tsx" || name === "global-error.tsx", 3).map((file) => ({
  file,
  shown: path.relative(APP_DIR, file).split(path.sep).join("/"),
}));

type Boundary = ComponentType<{ error: unknown; retry: () => void }>;

/* Each boundary rendered at an address with no dynamic segment, the landing's, whose params the App Router answers as
   an empty object, so a boundary drawing a frame's menu reads the path and them as it does in the browser. */
const ROUTED = { pathname: "/", params: {} };

const boundaryOf = async (file: string): Promise<Boundary> => ((await import(pathToFileURL(file).href)) as { default: Boundary }).default;

// Each case below renders a boundary, which posts its crash report to the page's own host, answered at any path: the
// cases read the path it was posted to.
const sent = serveHost("http://localhost", () => new Response(null, { status: 204 }));
const { answered } = serveBackend();

/** Every crash report the case's boundary posted, by the path it was posted to and its method. */
const reportsSent = () => sent.map(({ url, method }) => ({ address: url.pathname, method }));

afterEach(() => {
  cleanup();
});

/* One block per boundary, so a boundary broken beside another is named in its own right. */
describe.each(BOUNDARIES)("the error boundary $shown", ({ file, shown }) => {
  /* The failure this case exists for is silent by construction: a boundary reporting nothing
     leaves no line to miss, and the segments render no component in common to hold instead. */
  it("sends its crash report to a route this app serves", async () => {
    const Boundary = await boundaryOf(file);

    renderUnderNext(h(Boundary, { error: new Error("gepflanzt"), retry: () => undefined }), ROUTED);
    // `render` has already flushed the effect sending the report; waiting for its answer charges a
    // second report sent meanwhile to this boundary's count, never to the next one's.
    await act(answered);
    const reports = reportsSent();

    expect(reports.length, `sends ${String(reports.length)} reports of one crash`).toBe(1);
    expect(reports[0]?.method, "asks for its report rather than sending it").toBe("POST");

    // The hook posting to a path Next serves nothing at answers 404, and the `catch` that keeps a
    // failed report from crashing the boundary again hides it.
    const route = path.join(APP_DIR, ...(reports[0]?.address ?? "").split("/"), "route.ts");
    expect(existsSync(route), `reports to ${String(reports[0]?.address)}, where the app serves no route`).toBe(true);
  });

  /* Next passes a Client Component's throw on as it was thrown, so a boundary reading it as an
     `Error` raises in place of its panel. A press or the router re-renders the boundary, and a report keyed
     on an `Error` rebuilt from the value on each render would post the one crash again. */
  it("renders a thrown non-Error and reports it once across a re-render", async () => {
    const Boundary = await boundaryOf(file);

    const { rerender } = renderUnderNext(h(Boundary, { error: null, retry: () => undefined }), ROUTED);
    rerender(h(Boundary, { error: null, retry: () => undefined }));
    await act(answered);

    expect(sent.length, `${shown}: reports one thrown null ${String(sent.length)} times`).toBe(1);
  });

  /* A boundary that leaves the `retry` Next hands it unread draws a card whose one press does nothing, and nobody
     presses it before a page fails in earnest. */
  it("retries through the `retry` Next hands it", async () => {
    const Boundary = await boundaryOf(file);
    const retry = vi.fn<() => void>();

    renderUnderNext(h(Boundary, { error: new Error("gepflanzt"), retry }), ROUTED);
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.retry }));

    expect(retry, `${shown}: the card's press reaches Next's retry`).toHaveBeenCalledOnce();
  });
});

/** A frame read failing as it is drawn, as a rejected seasons or account read meets `use`. */
function FailingRead(): null {
  throw new Error("gepflanzt");
}

/* The rail frame's own boundary is no `error.tsx`, so the sweep above never lists it; its failure is as silent. */
describe("the rail frame's own boundary", () => {
  it("sends one crash report to a route this app serves", async () => {
    const { RailFrameBoundary } = await import("@/kit/RailFrameBoundary");
    // React reports the caught throw on the console, which says nothing this case reads.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    onTestFinished(() => quiet.mockRestore());

    // The frame drawn again commits once its account read settles, so the render waits for it.
    await act(async () => {
      renderUnderNext(h(RailFrameBoundary, { groups: [], bar: ["overview"] }, h(FailingRead)), ROUTED);
    });
    await act(answered);
    const reports = reportsSent();

    expect(reports).toHaveLength(1);
    expect(reports[0]?.method).toBe("POST");
    expect(existsSync(path.join(APP_DIR, ...(reports[0]?.address ?? "").split("/"), "route.ts"))).toBe(true);
  });

  /* `catchError` hands its `retry` beside the error rather than among the props, so a fallback reading the props
     alone draws a card whose press does nothing. */
  it("draws the frame again once a retry's fresh read answers", async () => {
    const { RailFrameBoundary } = await import("@/kit/RailFrameBoundary");
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    onTestFinished(() => quiet.mockRestore());

    // The read fails until the router's refresh, which Next's retry asks before it draws the children again.
    let answered = false;
    const refresh = vi.fn(() => {
      answered = true;
    });
    function ReadOnceRefreshed() {
      if (!answered) throw new Error("gepflanzt");
      return h("p", null, "gelesen");
    }
    const router = {
      back: () => undefined,
      forward: () => undefined,
      refresh,
      push: () => undefined,
      replace: () => undefined,
      prefetch: () => undefined,
      bfcacheId: "",
    };

    await act(async () => {
      renderUnderNext(h(RailFrameBoundary, { groups: [], bar: ["overview"] }, h(ReadOnceRefreshed)), { ...ROUTED, router });
    });
    await userEvent.click(screen.getByRole("button", { name: COPY.shared.verb.retry }));

    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.getByText("gelesen")).toBeDefined();
    expect(screen.queryByRole("button", { name: COPY.shared.verb.retry })).toBeNull();
  });
});
