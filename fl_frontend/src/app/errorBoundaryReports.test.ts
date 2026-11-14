// @vitest-environment jsdom
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createElement as h } from "react";

import { underNext } from "@/test-support/nextContexts.ts";
import { filesUnder } from "@/test-support/treeWalk.ts";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy.ts";
import { ROUTES } from "@/core/routes.ts";

import type { ComponentType } from "react";
import type { MockInstance } from "vitest";

const APP_DIR = import.meta.dirname;

/* Next's own file convention decides this listing, so a segment given a boundary tomorrow is swept
   with no edit here. `global-error.tsx` too: it replaces the root boundary rather than joining it. */
const BOUNDARIES = filesUnder(APP_DIR, (name) => name === "error.tsx" || name === "global-error.tsx", 3).map((file) => ({
  file,
  shown: path.relative(APP_DIR, file).split(path.sep).join("/"),
}));

type Boundary = ComponentType<{ error: unknown; retry: () => void }>;

/* Each boundary rendered at an address with no dynamic segment, whose params the App Router answers as an empty
   object, so a boundary drawing a frame's menu reads them as it does in the browser. */
const ROUTED = { params: {} };

const boundaryOf = async (file: string): Promise<Boundary> => ((await import(pathToFileURL(file).href)) as { default: Boundary }).default;

// Each case below renders a boundary, which posts its crash report, so none reaches a network.
let sent: MockInstance<typeof fetch>;

beforeEach(() => {
  sent = vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
});

afterEach(() => {
  cleanup();
  sent.mockRestore();
});

/* One block per boundary, so a boundary broken beside another is named in its own right. */
describe.each(BOUNDARIES)("the error boundary $shown", ({ file, shown }) => {
  /* The failure this case exists for is silent by construction: a boundary reporting nothing
     leaves no line to miss, and the segments render no component in common to hold instead. */
  it("sends its crash report to a route this app serves", async () => {
    const Boundary = await boundaryOf(file);

    render(underNext(h(Boundary, { error: new Error("gepflanzt"), retry: () => undefined }), ROUTED));
    // `render` has already flushed the effect sending the report; the turn after its answer charges a
    // second report sent meanwhile to this boundary's count, never to the next one's.
    await act(() => Promise.resolve());
    const reports = sent.mock.calls.map(([input, init]) => ({ address: String(input), method: init?.method }));

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

    const { rerender } = render(underNext(h(Boundary, { error: null, retry: () => undefined }), ROUTED));
    rerender(underNext(h(Boundary, { error: null, retry: () => undefined }), ROUTED));
    await act(() => Promise.resolve());

    expect(sent.mock.calls.length, `${shown}: reports one thrown null ${String(sent.mock.calls.length)} times`).toBe(1);
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

    const next = { label: COPY.shared.end.toOverview, href: ROUTES.admin.path() };
    // The frame drawn again commits once its account read settles, so the render waits for it.
    await act(async () => {
      render(underNext(h(RailFrameBoundary, { groups: [], bar: ["overview"], next }, h(FailingRead)), ROUTED));
    });
    const reports = sent.mock.calls.map(([input, init]) => ({ address: String(input), method: init?.method }));

    expect(reports).toHaveLength(1);
    expect(reports[0]?.method).toBe("POST");
    expect(existsSync(path.join(APP_DIR, ...(reports[0]?.address ?? "").split("/"), "route.ts"))).toBe(true);
  });
});
