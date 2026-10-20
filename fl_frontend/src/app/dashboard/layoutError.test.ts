import "@/shared/testing/dom.ts";
import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { cleanup, render } from "@testing-library/react";

import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answerReadsWith, backendUnreachable, callPage, EMPTIEST_ANSWER } from "@/shared/testing/pageHarness.ts";

import type { ReactElement, ReactNode } from "react";

// The area's panel reports the crash it draws.
const fetchDouble = doubleFetch();

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step and the doubles as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: DashboardLayout } = await import("@/app/dashboard/layout.tsx");
const { DashboardAreaBoundary } = await import("@/features/dashboard/components/providers/DashboardAreaBoundary.tsx");

/** The backend unreached while the season list's cache is cold, which the season slot reads in the layout. */
const OUTAGE = backendUnreachable("/saisons");

const Throwing = (): never => {
  throw OUTAGE;
};

const NO_PROPS = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

/* The dashboard's `error.tsx` sits inside its layout, so a throw in the season slot would reach the root
   boundary, which draws no bar (`docs/frontend/spec.md :: I385`). */
describe("a read failing in the dashboard's layout", () => {
  it("throws inside the boundary the layout wraps itself in", async () => {
    answerReadsWith((endpoint, schema, params) => {
      if (endpoint === "/saisons") throw OUTAGE;
      return EMPTIEST_ANSWER(endpoint, schema, params);
    });
    const tree = DashboardLayout({ children: h("p", null, "Seite") }) as ReactElement<{ children?: ReactNode }>;

    assert.equal(tree.type, DashboardAreaBoundary, "the dashboard's layout renders no boundary of its own around its reads");
    const { thrown } = await callPage(() => tree.props.children, NO_PROPS);
    assert.ok(thrown.includes(OUTAGE), "the dashboard's layout reads nothing inside its boundary that could fail");
  });

  /* The bar stands, its links and the theme control in reach, and the area's own panel answers. */
  it("is answered by the area's own panel inside the dashboard's shell", () => {
    fetchDouble.mock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));

    const { container } = render(underNext(h(DashboardAreaBoundary, null, h(Throwing)), { pathname: "/dashboard/spielplan" }));
    try {
      assert.ok(container.querySelector("[data-app-shell]"), "the dashboard answers its failing read outside its shell");
      assert.ok(container.textContent.includes("Spielunterbrechung"), "the dashboard answers its failing read with no panel");
      assert.ok(container.textContent.includes("Ansicht neu laden"), "the dashboard's panel offers no retry");
      assert.equal(container.querySelectorAll("h1").length, 1, "the dashboard's panel raises a heading the shell owns");
    } finally {
      cleanup();
    }
  });
});
