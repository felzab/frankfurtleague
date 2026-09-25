import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h, useContext } from "react";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { PathnameContext, SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { nextRouter, recordingRouter, underNext } from "./nextContexts.ts";
import { renderTree } from "./renderTest.ts";

/** The three values a component reads, joined so one render reports all of them. */
function Probe(): ReturnType<typeof h> {
  const router = useContext(AppRouterContext);
  const search = useContext(SearchParamsContext);
  const pathname = useContext(PathnameContext);

  return h("p", null, `${router === null ? "no router" : router.bfcacheId} | ${search?.get("saison_id") ?? "none"} | ${pathname ?? "none"}`);
}

describe("the router a test mounts", () => {
  it("answers every member of Next's interface, and takes an override over the inert default", () => {
    const router = nextRouter({ bfcacheId: "eigen" });

    for (const member of ["back", "forward", "refresh", "push", "replace", "prefetch"] as const) {
      assert.equal(typeof router[member], "function", `\`${member}\` is not a call the component can make`);
    }
    assert.equal(router.bfcacheId, "eigen");
  });

  /* Both halves: a recorder that logged the press but dropped the href would pass every case
     counting navigations and none reading where the reader was sent. */
  it("records each navigation with the address it carried", () => {
    const { router, seen } = recordingRouter();
    // Taken off the router rather than called on it: `no-restricted-syntax` bans the member call, and
    // each member closes over the log rather than over `this`.
    const { push, replace, back, refresh } = router;

    push("/admin/spieler");
    replace("/admin/teams");
    back();
    refresh();

    assert.deepEqual(seen, { pushed: ["/admin/spieler"], replaced: ["/admin/teams"], back: 1, refresh: 1 });
  });
});

describe("the tree a test mounts under Next", () => {
  it("carries the router, the search parameters and the path to what it wraps", () => {
    const markup = renderTree(
      underNext(h(Probe), { router: nextRouter({ bfcacheId: "gesetzt" }), search: "saison_id=2026", pathname: "/admin/spieler" }),
    );

    assert.match(markup, /gesetzt \| 2026 \| \/admin\/spieler/);
  });

  /* A caller naming no path is one whose component does not read one: the default has to be what the
     context carries with no provider, or mounting the wrapper would change that component's answer. */
  it("leaves the path unset where no caller names one, and still answers a parameter read", () => {
    assert.match(renderTree(underNext(h(Probe))), /\| none \| none/);
  });
});
