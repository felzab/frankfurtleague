import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* `useRouter` reads a context no `next/navigation` export carries, so the panel renders under the one Next keeps it on. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import { render } from "@testing-library/react";

import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";
import { deriveDraftStatus } from "@/shared/utils/draftStatus.ts";

import type { ContextType } from "react";

const { FormKaderSection } = await import("./FormKaderSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

/** No descriptor for any path, which is the state the panel stands in until a save judges one. */
const STATUS = deriveDraftStatus<null, string>({ descriptors: [], stored: null, draft: null, fieldErrors: {} });

/** Every method the panel reaches only after a write, which no case here makes. */
const ROUTER: NonNullable<ContextType<typeof AppRouterContext>> = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "formKaderSection",
};

const panel = (teamId: string | null) =>
  render(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(DraftStatusProvider, {
        status: STATUS,
        children: h(FormKaderSection, {
          saison: { saisonId: "2027", saisonStatus: "future", erlaubteStufen: [] },
          teams: [{ teamId: "t1", name: "SG Alpha", shorthand: "SGA" }],
          isMember: false,
          teamId,
          onTeamIdChange: () => undefined,
          nummer: "",
          onNummerChange: () => undefined,
          position: null,
          onPositionChange: () => undefined,
          stufe: null,
          onStufeChange: () => undefined,
          rolle: null,
          onRolleChange: () => undefined,
          heldRollen: {},
          onValidateFields: () => undefined,
          onValidateSelection: () => undefined,
          spielerId: "s1",
          banners: [],
        }),
      }),
    ),
  );

describe("the squad entry, closed until a team is picked", () => {
  /* A pick lifts the closure, so a sentence beside the control would leave with it and move the panel under
     the reader (`docs/frontend/spec.md` §1.14). */
  it("names the missing team on the control alone", () => {
    panel(null);

    const grund = "Wähle zuerst ein Team.";
    closedControl("In Kader 2027 aufnehmen", grund);
    assert.equal(isInTheFlow(grund), false, "the missing team stands in the flow, which the pick takes it out of");
  });

  /* Both directions: an entry closed whatever is picked passes the case above and offers nothing. */
  it("opens once a team is picked", () => {
    panel("t1");

    assert.equal(isInTheFlow("Wähle zuerst ein Team."), false);
    assert.equal(document.querySelector('[aria-disabled="true"]'), null, "the entry stays closed with a team picked");
  });
});
