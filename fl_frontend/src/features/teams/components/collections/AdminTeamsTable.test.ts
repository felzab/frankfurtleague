import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { AdminTeamRow } from "../../types.ts";

doubleEveryAction();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminTeamsTable } = await import("./AdminTeamsTable.tsx");
const { TEAM_NICHT_STILLLEGBAR } = await import("../../constants.ts");

const club = (id: string, name: string, isRetireable: boolean): AdminTeamRow => ({
  id,
  name,
  full_name: `${name} Frankfurt`,
  shorthand: name.slice(0, 2).toUpperCase(),
  inactive_since: null,
  selected: { gruppe: "A", austritt: null },
  isRetireable,
  publicSaisonId: null,
});

describe("the club list's retirement", () => {
  /* Offered, the row's press would open a dialog whose write `REQ-RETIRE-001` refuses; the club's editor closes the
     same press with the same sentence. */
  it("stands closed with the editor's sentence on a club a running or planned season holds, and opens on one it does not", async () => {
    const pressed: string[] = [];
    render(
      underNext(
        h(AdminTeamsTable, {
          filteredTeams: [club("68d0f2a4c1e2b3a4d5e6f701", "Goethe", false), club("68d0f2a4c1e2b3a4d5e6f702", "Lessing", true)],
          emptiness: "none",
          setDeletingTeam: (team) => pressed.push(team.name),
        }),
        { search: "saison_id=2026" },
      ),
    );
    const user = userEvent.setup();
    // The table alone: the phone cards render the same controls beside it.
    const table = within(screen.getByRole("grid", { name: "Tabelle aller Teams" }));

    const closed = table.getByRole("button", { name: "Stilllegen: Team Goethe", description: TEAM_NICHT_STILLLEGBAR });
    assert.equal(closed.getAttribute("aria-disabled"), "true", "the closed retirement is announced as usable");
    // The open one first: the closed one's press opens its reason's popover, which hides the rest of the page.
    await user.click(table.getByRole("button", { name: "Stilllegen: Team Lessing" }));
    await user.click(closed);

    assert.deepEqual(pressed, ["Lessing"]);
  });
});
