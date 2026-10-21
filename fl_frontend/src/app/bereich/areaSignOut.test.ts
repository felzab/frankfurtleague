import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleEveryAction, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { doubleFetch } from "@/shared/testing/fetchDouble.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { ReactElement } from "react";

/** Every server action a shell calls, which must stay empty. */
const { calls: actionCalls } = doubleEveryAction();
doubleToasts();
/** The sign-out route, answered per case. */
const fetchMock = doubleFetch();

/** Every path a sign-out left the document for, a full document load jsdom does not implement. */
const left: string[] = [];
registerDoubles({ modules: { "shared/utils/documentNavigation.ts": { leaveDocumentFor: (to: string) => void left.push(to) } } });

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminShell } = await import("@/features/admin/components/ui/AdminShell.tsx");
const { PersonShell } = await import("@/features/funktionen/components/ui/PersonShell.tsx");
const { TeamShell } = await import("@/features/funktionen/components/ui/TeamShell.tsx");
const { PERSON_SIDEMENU_STRUCTURE } = await import("@/features/funktionen/constants.ts");

const PAGE = h("p", null, "Seiteninhalt");
const TEAM = { team_id: "6890a1b2c3d4e5f607250011", saison_id: "2526" };

const SHELLS: { name: string; shell: ReactElement; pathname: string; params?: Record<string, string> }[] = [
  {
    name: "the person area",
    shell: h(PersonShell, { structure: PERSON_SIDEMENU_STRUCTURE, funktionSwitcher: null, children: PAGE }),
    pathname: "/bereich",
  },
  {
    name: "the team area",
    shell: h(TeamShell, { saisonMetadataDisplay: null, funktionSwitcher: null, children: PAGE }),
    pathname: `/bereich/team/${TEAM.team_id}/${TEAM.saison_id}`,
    params: TEAM,
  },
  {
    name: "the admin area",
    shell: h(AdminShell, { saisonMetadataDisplay: null, funktionSwitcher: null, children: PAGE }),
    pathname: "/bereich/admin/teams",
  },
];

/* A server action deleting the session's cookie makes Next render the area again with the session gone, and the
   page's redirect empties it before the start page loads. */
describe("each area's sign-out (`docs/frontend/spec.md :: I831`)", () => {
  for (const { name, shell, pathname, params } of SHELLS) {
    it(`ends ${name}'s session at the sign-out route, calls no server action, and leaves by a document load`, async () => {
      fetchMock.mock.mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } })),
      );
      left.length = 0;
      actionCalls.length = 0;
      render(underNext(shell, { pathname, ...(params === undefined ? {} : { params }) }));

      await pressTwice(userEvent.setup(), { resting: "Abmelden", armed: "Abmelden?" });
      await act(fetchMock.answered);
      await waitFor(() => assert.deepEqual(left, ["/"]));

      const [url, init] = fetchMock.mock.calls[0]?.arguments ?? [];
      assert.deepEqual([url, init?.method, fetchMock.mock.callCount()], ["/api/signout", "POST", 1]);
      assert.deepEqual(actionCalls, [], `${name}'s sign-out called a server action`);
    });
  }
});
