import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it, mock } from "node:test";

import { createElement as h } from "react";
/* `useRouter` reads a context no `next/navigation` export carries, so the panel is rendered under the one Next
   keeps it on. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { describeAngesetzteSpiele, describeKaderAustragung, describeKaderAustragungDanach } from "@/features/saisons/utils.ts";
import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";
import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";

import { describeUebernommeneSpiele } from "./replacementOffer.ts";

import type { ContextType } from "react";

const replaceSaisonTeamAction = mock.fn(async (_payload: unknown) => ({ success: true, message: "TSV Beta steht jetzt auf dem Platz." }));
const toasts = { success: mock.fn(), danger: mock.fn() };
Reflect.set(globalThis, "__teamErsatzSection", { replaceSaisonTeamAction, toasts });

registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/features/teams/actions.ts"))
      return {
        format: "module",
        shortCircuit: true,
        source: "export const replaceSaisonTeamAction = (payload) => globalThis.__teamErsatzSection.replaceSaisonTeamAction(payload);",
      };
    if (url.endsWith("/src/shared/utils/appToast.ts"))
      return { format: "module", shortCircuit: true, source: "export const appToast = globalThis.__teamErsatzSection.toasts;" };
    return nextLoad(url, context);
  },
});

const { FormTeamErsatzSection } = await import("./FormTeamErsatzSection.tsx");

type ErsatzProps = Parameters<typeof FormTeamErsatzSection>[0];
type ErsatzRow = ErsatzProps["ersatz"]["rows"][number];
type ErsatzCandidate = ErsatzProps["ersatz"]["candidates"][number];

const ROUTER: NonNullable<ContextType<typeof AppRouterContext>> = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "FormTeamErsatzSection",
};

/** A place this season could hand over: a club nobody has played for yet. */
const row = (over: Partial<ErsatzRow> = {}): ErsatzRow => ({
  teamId: "t1",
  name: "SG Alpha",
  gruppe: "A",
  spiele: 4,
  gespielteSpiele: 0,
  hasAustritt: false,
  isVerwaist: false,
  ...over,
});

/** A club free to take it. */
const candidate = (over: Partial<ErsatzCandidate> = {}): ErsatzCandidate => ({
  id: "c1",
  name: "TSV Beta",
  isStillgelegt: false,
  isInSaison: false,
  ...over,
});

const panel = (ersatz: ErsatzProps["ersatz"], isFinishedSaison = false) =>
  h(AppRouterContext.Provider, { value: ROUTER, children: h(FormTeamErsatzSection, { saisonId: "2026-27", ersatz, isFinishedSaison }) });

/** The value the armed readout states beside `label`. */
const readout = (label: string): string | null => screen.getByText(label, { selector: "dt" }).nextElementSibling?.textContent ?? null;

describe("the replacement panel", () => {
  /* The Austritt and the squad are the two consequences an admin cannot predict, and the endpoint names the
     outgoing club in its path: swapped, it answers `REQ-REPLACE-003`, asked to replace the arriving club. */
  it("reads out what the arriving club takes over on the first press, and sends each club where the write names it on the second", async () => {
    const user = userEvent.setup();
    render(panel({ rows: [row()], candidates: [candidate()] }));

    await user.click(screen.getByRole("button", { name: /^Ausscheidendes Team/ }));
    await user.click(screen.getByRole("option", { name: /^SG Alpha/ }));
    await user.click(screen.getByRole("button", { name: /^Nachrückendes Team/ }));
    await user.click(screen.getByRole("option", { name: /^TSV Beta/ }));
    assert.ok(screen.getByText(`${describeUebernommeneSpiele(4)} ${describeKaderAustragung("SG Alpha")}`));

    mock.timers.enable({ apis: ["Date"] });
    try {
      await user.click(screen.getByRole("button", { name: "Team ersetzen" }));
      assert.equal(replaceSaisonTeamAction.mock.callCount(), 0, "one press wrote");
      assert.equal(readout("Platz in der Saison"), "Gruppe A");
      assert.equal(readout("Angesetzte Spiele"), describeAngesetzteSpiele(4));
      assert.equal(readout("Austritt von SG Alpha"), "keiner eingetragen");
      assert.match(screen.getByRole("alert").textContent, new RegExp(`keinen Weg zurück\\. ${describeKaderAustragungDanach("SG Alpha")}`));

      mock.timers.tick(DOUBLE_PRESS_MS);
      await user.click(screen.getByRole("button", { name: "Ja, Team ersetzen" }));
    } finally {
      mock.timers.reset();
    }

    assert.deepEqual(
      replaceSaisonTeamAction.mock.calls.map((call) => call.arguments),
      [[{ team_id: "t1", saison_id: "2026-27", incoming_team_id: "c1" }]],
    );
    // No undo: the undo route addresses the row by `team_id`, which answers to the arriving club by then.
    assert.deepEqual(
      toasts.success.mock.calls.map((call) => call.arguments),
      [["Team ersetzt", { description: "TSV Beta steht jetzt auf dem Platz." }]],
    );
  });

  /* A pick lifts this closure, so a sentence beside the control would leave with it and move the panel under
     the reader (`docs/frontend/spec.md` §1.14). */
  it("names the missing pair on the control alone", () => {
    render(panel({ rows: [row()], candidates: [candidate()] }));

    const grund = "Wähle das ausscheidende und das nachrückende Team.";
    closedControl("Team ersetzen", grund);
    assert.equal(isInTheFlow(grund), false, "the missing pair stands in the flow, which the pick takes it out of");
  });

  /* Each closure names the rule that shut the control, never the situation that met it
     (`docs/frontend/spec.md` §1.12), and offers no pickers for a press the endpoint would refuse. */
  it("explains each closure by its rule instead of offering the pickers", () => {
    const closures: [string, ErsatzProps["ersatz"], boolean][] = [
      ["In einer abgeschlossenen Saison lässt sich kein Team mehr ersetzen", { rows: [row()], candidates: [candidate()] }, true],
      ["Ersetzen lässt sich nur ein Team, das in dieser Saison steht", { rows: [], candidates: [candidate()] }, false],
      [
        "Nur Teams, die noch kein Spiel gespielt haben, können ersetzt werden",
        { rows: [row({ gespielteSpiele: 2 })], candidates: [candidate()] },
        false,
      ],
      [
        "Nachrücken kann nur ein Team, das in dieser Saison noch nicht dabei und nicht stillgelegt ist",
        { rows: [row()], candidates: [candidate({ isInSaison: true })] },
        false,
      ],
    ];

    for (const [title, ersatz, isFinishedSaison] of closures) {
      const { unmount } = render(panel(ersatz, isFinishedSaison));

      assert.ok(screen.getByText(title), `the closure reads otherwise than „${title}“`);
      assert.equal(screen.queryByRole("button", { name: /^Ausscheidendes Team/ }), null, `„${title}“ still offers the pickers`);
      unmount();
    }
  });

  /* Dictated copy, whole: a body under it is the failure. */
  it("carries the dictated closure as its title alone", () => {
    render(panel({ rows: [row({ gespielteSpiele: 2 })], candidates: [candidate()] }));

    assert.equal(screen.getByText("Nur Teams, die noch kein Spiel gespielt haben, können ersetzt werden").nextElementSibling, null);
  });
});
