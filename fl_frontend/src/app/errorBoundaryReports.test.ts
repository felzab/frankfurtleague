// @vitest-environment jsdom
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { createElement as h, startTransition, Suspense, use, useState } from "react";

import { answersInFlight } from "@/test-support/answersInFlight.ts";
import { underNext } from "@/test-support/nextContexts.ts";
import { filesUnder } from "@/test-support/treeWalk.ts";
import { act, cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ComponentType } from "react";

const APP_DIR = import.meta.dirname;

/* Next's own file convention decides this listing, so a segment given a boundary tomorrow is swept
   with no edit here. `global-error.tsx` too: it replaces the root boundary rather than joining it. */
const BOUNDARIES = filesUnder(APP_DIR, (name) => name === "error.tsx" || name === "global-error.tsx", 3).map((file) => ({
  file,
  shown: path.relative(APP_DIR, file).split(path.sep).join("/"),
}));

type Boundary = ComponentType<{ error: Error & { digest?: string }; retry: () => void }>;

const boundaryOf = async (file: string): Promise<Boundary> => ((await import(pathToFileURL(file).href)) as { default: Boundary }).default;

/** The refresh a retry below sets off, held until its case answers it. */
const refreshes = answersInFlight();

/** The router's state while its fetch is in flight, which suspends whatever reads it. */
function Held({ until }: { until: Promise<void> }): null {
  use(until);

  return null;
}

// Each case below renders a boundary, which posts its crash report, so none reaches a network.
let sent: ReturnType<typeof vi.spyOn<typeof globalThis, "fetch">>;

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

    render(underNext(h(Boundary, { error: new Error("gepflanzt"), retry: () => undefined })));
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

  /* Next's `retry` is the refresh and the reset in one transition. A boundary wiring the two itself
     can drop either half with nothing failing, and a reset alone replays the router's cached failure. */
  it("calls the retry Next handed it once per press", async () => {
    const Boundary = await boundaryOf(file);
    const retry = vi.fn();

    render(underNext(h(Boundary, { error: new Error("gepflanzt"), retry })));
    await userEvent.setup().click(screen.getByRole("button"));

    expect(retry, `${shown}: a press calls the retry Next handed it`).toHaveBeenCalledTimes(1);
  });

  /* Next's refresh suspends its transition on the server's answer, and only a press inside the
     boundary's own transition reads as pending meanwhile: a bare call reports nothing and invites a
     second press. */
  it("holds the press pending while the refresh it set off is in flight", async () => {
    const Boundary = await boundaryOf(file);
    let answer = (): void => undefined;
    const serverAnswer = new Promise<void>((resolve) => {
      answer = resolve;
    });

    /* What Next's `retry` does, a transition setting the router's state to the server's answer still
       on its way, which the router reads with `use`. */
    function Refreshing() {
      const [refresh, setRefresh] = useState<Promise<void> | null>(null);
      const retry = () => startTransition(() => setRefresh(refreshes.track("the refresh", serverAnswer)));

      return h(
        Suspense,
        { fallback: null },
        refresh === null ? null : h(Held, { until: refresh }),
        h(Boundary, { error: new Error("gepflanzt"), retry }),
      );
    }

    render(underNext(h(Refreshing)));
    const press = screen.getByRole("button");
    await userEvent.setup().click(press);

    expect(press.hasAttribute("disabled"), "the press stands enabled while its refresh is in flight").toBe(true);
    expect(press.textContent, "the press does not say it is reloading while its refresh is in flight").toMatch(/Lädt neu/);

    answer();
    await act(refreshes.answered);
    expect(press.hasAttribute("disabled"), "the press stays disabled once the refresh answered").toBe(false);
  });
});
