import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, it, mock } from "node:test";
import { pathToFileURL } from "node:url";

import { createElement as h, startTransition, Suspense, use, useState } from "react";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { filesUnder } from "@/core/treeWalk.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";

import type { ComponentType } from "react";

const APP_DIR = path.resolve(import.meta.dirname, "..", "..", "app");

const fetchDouble = doubleFetch();

/* Next's own file convention decides this listing, so a segment given a boundary tomorrow is swept
   with no edit here. `global-error.tsx` too: it replaces the root boundary rather than joining it. */
const BOUNDARIES = filesUnder(APP_DIR, (name) => name === "error.tsx" || name === "global-error.tsx", 3);

type Boundary = ComponentType<{ error: Error & { digest?: string }; retry: () => void }>;

/** The requests one boundary sent while it drew a client crash, each as its address and its method. */
async function reportsOf(file: string, shown: string): Promise<{ address: string; method: string | undefined }[]> {
  fetchDouble.mock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
  const { default: Boundary } = (await import(pathToFileURL(file).href)) as { default: Boundary };

  const before = fetchDouble.mock.calls.length;
  render(underNext(h(Boundary, { error: new Error("gepflanzt"), retry: () => undefined })));
  try {
    // The report is sent from an effect, after the boundary has drawn.
    await waitFor(() =>
      assert.ok(
        fetchDouble.mock.calls.length > before,
        `${shown}: renders a segment's crash and reports none of it, so the crash reaches the browser's console and nothing else`,
      ),
    );
  } finally {
    cleanup();
  }

  return fetchDouble.mock.calls.slice(before).map(({ arguments: [input, init] }) => ({ address: String(input), method: init?.method }));
}

describe("the crash report every error boundary stands behind", () => {
  /* The failure this case exists for is silent by construction: a boundary reporting nothing
     leaves no line to miss, and the segments render no component in common to hold instead. */
  it("is sent from every boundary the app tree holds, to a route this app serves", async () => {
    for (const file of BOUNDARIES) {
      const shown = path.relative(APP_DIR, file).split(path.sep).join("/");
      const reports = await reportsOf(file, shown);

      assert.equal(reports.length, 1, `${shown}: sends ${String(reports.length)} reports of one crash`);
      assert.equal(reports[0]!.method, "POST", `${shown}: asks for its report rather than sending it`);

      // The hook posting to a path Next serves nothing at answers 404, and the `catch` that keeps a
      // failed report from crashing the boundary again hides it.
      const route = path.join(APP_DIR, ...reports[0]!.address.split("/"), "route.ts");
      assert.ok(existsSync(route), `${shown}: reports to ${reports[0]!.address}, where the app serves no route`);
    }
  });
});

/** The router's state while its fetch is in flight, which suspends whatever reads it. */
function Held({ until }: { until: Promise<void> }): null {
  use(until);
  return null;
}

describe("the retry every error boundary offers", () => {
  /* Next's `retry` is the refresh and the reset in one transition. A boundary wiring the two itself
     can drop either half with nothing failing, and a reset alone replays the router's cached failure. */
  it("is the retry Next hands the boundary, and the boundary refreshes nothing itself", async () => {
    fetchDouble.mock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));

    for (const file of BOUNDARIES) {
      const shown = path.relative(APP_DIR, file).split(path.sep).join("/");
      const { default: Boundary } = (await import(pathToFileURL(file).href)) as { default: Boundary };
      const retry = mock.fn();
      const { router, seen } = recordingRouter();

      render(underNext(h(Boundary, { error: new Error("gepflanzt"), retry }), { router }));
      try {
        await userEvent.setup().click(screen.getByRole("button"));

        assert.equal(retry.mock.callCount(), 1, `${shown}: a press calls the retry Next handed it ${String(retry.mock.callCount())} times`);
        assert.equal(seen.refresh, 0, `${shown}: refreshes the router beside the retry, which refreshes it already`);
      } finally {
        cleanup();
      }
    }
  });

  /* Next's refresh suspends its transition on the server's answer, and only a press inside the
     boundary's own transition reads as pending meanwhile: a bare call reports nothing and invites a
     second press. */
  it("holds the press pending while the refresh it set off is in flight", async () => {
    fetchDouble.mock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));

    for (const file of BOUNDARIES) {
      const shown = path.relative(APP_DIR, file).split(path.sep).join("/");
      const { default: Boundary } = (await import(pathToFileURL(file).href)) as { default: Boundary };
      let answer = (): void => undefined;
      const answered = new Promise<void>((resolve) => {
        answer = resolve;
      });

      /* What Next's `retry` does, a transition setting the router's state to the server's answer still
         on its way, which the router reads with `use`. */
      function Refreshing() {
        const [refresh, setRefresh] = useState<Promise<void> | null>(null);
        const retry = () => startTransition(() => setRefresh(answered));

        return h(
          Suspense,
          { fallback: null },
          refresh === null ? null : h(Held, { until: refresh }),
          h(Boundary, { error: new Error("gepflanzt"), retry }),
        );
      }

      render(underNext(h(Refreshing)));
      try {
        const press = screen.getByRole("button");
        await userEvent.setup().click(press);

        assert.ok(press.hasAttribute("disabled"), `${shown}: the press stands enabled while its refresh is in flight`);
        assert.match(press.textContent, /Lädt neu/, `${shown}: the press reads ${press.textContent} while its refresh is in flight`);

        answer();
        await waitFor(() => assert.ok(!press.hasAttribute("disabled"), `${shown}: the press stays disabled once the refresh answered`));
      } finally {
        cleanup();
      }
    }
  });
});
