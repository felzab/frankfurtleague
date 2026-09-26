import "@/shared/testing/dom.ts";
import "@/shared/testing/pageHarness.ts";

import assert from "node:assert/strict";
import { createRequire, registerHooks } from "node:module";
import { describe, it } from "node:test";

import { Component, createElement as h } from "react";
import { notFound, redirect } from "next/navigation";

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { APIBadStatusError } from "@/core/errors.ts";
import { doubleActionRequest, doubleEveryAction, exportingModule } from "@/shared/testing/actionDoubles.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { answerReadsWith, callPage, EMPTIEST_ANSWER, renderPage } from "@/shared/testing/pageHarness.ts";

import type * as NextError from "next/error";
import type { ComponentType, ReactElement, ReactNode } from "react";

const { setSession, setSubject } = doubleActionRequest();
// Each shell hands a sign-out action to the bar, whose real module reaches `next/server` past the harness.
doubleEveryAction();
// The area's panel reports the crash it draws.
const fetchDouble = doubleFetch();

/* `next/error` is CommonJS whose exports Node's static reader cannot see, so an area boundary's ESM
   import of `catchError` fails at link. The shim hands on the real function rather than a stand-in. */
const NEXT_ERROR_INTEROP = exportingModule({ catchError: (createRequire(import.meta.filename)("next/error") as typeof NextError).catchError });

/* The admin shell's passkey dialog builds the browser's auth client as it loads, which reads the page's
   origin, and this window has none. No case opens the dialog, so every ceremony refuses. */
const refused = (): never => {
  throw new Error("no case here opens the passkey dialog");
};
const AUTH_CLIENT_DOUBLE = exportingModule({ authClient: { passkey: { addPasskey: refused }, signIn: { passkey: refused } } });

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/error") return { url: `data:text/javascript,${encodeURIComponent(NEXT_ERROR_INTEROP)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/authClient.ts")) return { format: "module", source: AUTH_CLIENT_DOUBLE, shortCircuit: true };
    return nextLoad(url, context);
  },
});

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step and the doubles as it evaluates (`docs/frontend/spec.md` §1.9). */
const { default: PersoenlichLayout } = await import("@/app/bereich/(persoenlich)/layout.tsx");
const { default: TeamLayout } = await import("@/app/bereich/team/[team_id]/[saison_id]/layout.tsx");
const { default: AdminLayout } = await import("@/app/bereich/admin/layout.tsx");
const { PersonAreaBoundary } = await import("@/features/funktionen/components/providers/PersonAreaBoundary.tsx");
const { TeamAreaBoundary } = await import("@/features/funktionen/components/providers/TeamAreaBoundary.tsx");
const { AdminAreaBoundary } = await import("@/features/admin/components/providers/AdminAreaBoundary.tsx");
const { TEAM_SHELL_FALLBACK, TEAM_SHELL_REFUSAL } = await import("@/features/funktionen/constants.ts");

const TEAM = { team_id: "6890a1b2c3d4e5f607250011", saison_id: "2526" };
const NO_PROPS = { params: Promise.resolve({}), searchParams: Promise.resolve({}) };

/** What the backend answered the layout's read with: an outage, never a missing session. */
const OUTAGE = new Error("die Anmeldung ist nicht erreichbar");

const Redirecting = (): never => redirect("/signin");
const Missing = (): never => notFound();

/** Next's two answers a boundary must hand on, each with the digest Next acts on. */
const NAVIGATIONS = [
  { child: Redirecting, digest: "NEXT_REDIRECT;replace;/signin;307;" },
  { child: Missing, digest: "NEXT_HTTP_ERROR_FALLBACK;404" },
];

/** Next's own boundary above the area's, recording what reached it rather than rendering it. */
class Above extends Component<{ caught: unknown[]; children?: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    this.props.caught.push(error);
  }

  override render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

const Throwing = (): never => {
  throw OUTAGE;
};

type Area = {
  name: string;
  /** The layout as Next mounts it, with a page slot standing in for whatever page is asked for. */
  layout: () => ReactElement<{ children?: ReactNode }>;
  boundary: ComponentType<{ children?: ReactNode }>;
  /** Makes the read the layout's guard awaits throw. */
  failRead: () => void;
  pathname: string;
  params: Record<string, string> | null;
};

const AREAS: Area[] = [
  {
    name: "the person area",
    layout: () => PersoenlichLayout({ children: h("p", null, "Seite") }) as ReactElement<{ children?: ReactNode }>,
    boundary: PersonAreaBoundary,
    failRead: () => setSubject(OUTAGE),
    pathname: "/bereich",
    params: null,
  },
  {
    name: "the team area",
    layout: () => TeamLayout({ params: Promise.resolve(TEAM), children: h("p", null, "Seite") }) as ReactElement<{ children?: ReactNode }>,
    boundary: TeamAreaBoundary,
    failRead: () => setSubject(OUTAGE),
    pathname: `/bereich/team/${TEAM.team_id}/${TEAM.saison_id}`,
    params: TEAM,
  },
  {
    name: "the admin area",
    layout: () => AdminLayout({ children: h("p", null, "Seite") }) as ReactElement<{ children?: ReactNode }>,
    boundary: AdminAreaBoundary,
    failRead: () => setSession(OUTAGE),
    pathname: "/bereich/admin/sperrliste",
    params: null,
  },
];

describe("a read failing in an area's layout", () => {
  /* The area's `error.tsx` sits inside its layout, so a throw in the layout's guard or chrome reaches
     the root boundary, the visitor's chrome and all, unless the layout wraps it itself. */
  it("throws inside the boundary the layout wraps itself in", async () => {
    for (const area of AREAS) {
      area.failRead();
      const tree = area.layout();

      assert.equal(tree.type, area.boundary, `${area.name}'s layout renders no boundary of its own around its reads`);
      const { thrown } = await callPage(() => tree.props.children, NO_PROPS);
      assert.ok(thrown.includes(OUTAGE), `${area.name}'s layout reads nothing inside its boundary that could fail`);
    }
  });

  /* The shell stays, so the person keeps the bar's sign-out and the area's own panel answers. */
  it("is answered by the area's own panel inside the area's shell", () => {
    fetchDouble.mock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));

    for (const area of AREAS) {
      const { container } = render(
        underNext(h(area.boundary, null, h(Throwing)), { pathname: area.pathname, ...(area.params === null ? {} : { params: area.params }) }),
      );
      try {
        assert.ok(container.querySelector("[data-app-shell]"), `${area.name} answers its failing read outside its shell`);
        assert.ok(container.textContent.includes("Spielunterbrechung"), `${area.name} answers its failing read with no panel`);
        assert.ok(container.textContent.includes("Ansicht neu laden"), `${area.name}'s panel offers no retry`);
        assert.equal(container.querySelectorAll("h1").length, 1, `${area.name}'s panel raises a heading the shell owns`);
        assert.ok(container.querySelector('[aria-label="Abmelden"]'), `${area.name} leaves its person no way to sign out`);
      } finally {
        cleanup();
      }
    }
  });

  /* The guard's own answer to a missing session is a redirect, which is Next's to act on: caught here,
     a lapsed session would read as an outage rather than reach sign-in. */
  it("lets a redirect and a not-found through to Next", () => {
    for (const area of AREAS) {
      for (const { child, digest } of NAVIGATIONS) {
        const caught: unknown[] = [];
        const { container } = render(
          underNext(h(Above, { caught }, h(area.boundary, null, h(child))), {
            pathname: area.pathname,
            ...(area.params === null ? {} : { params: area.params }),
          }),
        );
        try {
          assert.deepEqual(
            caught.map((error) => (error as { digest?: unknown }).digest),
            [digest],
            `${area.name}'s boundary keeps ${digest} from Next`,
          );
          assert.ok(!container.textContent.includes("Spielunterbrechung"), `${area.name} answers ${digest} with its error panel`);
        } finally {
          cleanup();
        }
      }
    }
  });
});

describe("the bar over the team area's crash panel", () => {
  /* A failing read says nothing about the seats the person holds, so the bar keeps the area's own words
     rather than the refusal's, which would tell a seat holder they hold no seat. */
  it("keeps the area's own hint and never the refusal's", async () => {
    fetchDouble.mock.mockImplementation(() => Promise.resolve(new Response(null, { status: 204 })));
    render(underNext(h(TeamAreaBoundary, null, h(Throwing)), { pathname: `/bereich/team/${TEAM.team_id}/${TEAM.saison_id}`, params: TEAM }));
    try {
      await userEvent.setup().click(screen.getByRole("button", { name: `Was auf „${TEAM_SHELL_FALLBACK.label}“ zu finden ist` }));
      const shown = document.body.textContent;

      assert.ok(shown.includes(TEAM_SHELL_FALLBACK.hint.lead), "the crash panel's bar reads no hint of the area's own");
      assert.ok(!shown.includes(TEAM_SHELL_REFUSAL.hint.lead), "the crash panel's bar tells a seat holder they hold no seat");
    } finally {
      cleanup();
    }
  });
});

describe("the administrator's switcher failing its lookup", () => {
  /* The switcher is one row of the rail, and the administration needs no backend answer to be reached:
     a lookup the backend fails must not replace every admin page with the area's crash panel. */
  it("renders the admin page and no switcher", async () => {
    answerReadsWith((endpoint, schema, params) => {
      if (endpoint !== "/identitaet/subjekt") return EMPTIEST_ANSWER(endpoint, schema, params);
      throw new APIBadStatusError({
        message: "unavailable",
        url: `http://backend/api/v0${endpoint}`,
        statusCode: 503,
        endpoint: endpoint,
        method: "POST",
        readOnly: true,
        traceId: "0",
      });
    });
    try {
      const markup = await renderPage(
        underNext(h(AdminLayout, { children: h("p", null, "Seite") }), { pathname: "/bereich/admin/sperrliste" }),
      );

      assert.ok(markup.includes("<p>Seite</p>"), "the admin page is gone where the switcher's lookup failed");
      assert.ok(!markup.includes("Spielunterbrechung"), "a failed switcher lookup takes the admin area down");
      assert.ok(!markup.includes("Funktion wechseln"), "a switcher stands with no records to list");
    } finally {
      answerReadsWith(EMPTIEST_ANSWER);
    }
  });
});
