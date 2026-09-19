import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* `useSearchParams` reads a context no `next/navigation` export carries, so the list is mounted under
   the one Next keeps it on, as `fl_frontend/src/app/notFound.test.ts` mounts its boundaries. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { render, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { nextRouter } from "@/shared/testing/nextContexts.ts";

import { publicTeamSaisonId } from "./utils.ts";

import type { FLSaisonStatus } from "@/features/saisons/schemas";
import type { AdminTeamRow } from "./types.ts";

const { AdminTeamsTable } = await import("./components/collections/AdminTeamsTable.tsx");

const saison = (id: string, status: FLSaisonStatus) => ({ id, status });

const VERGANGEN = saison("2025", "past");
const LAUFEND = saison("2026", "active");
const GEPLANT = saison("2027", "future");
const SAISONS = [VERGANGEN, LAUFEND, GEPLANT];

const inSaisons = (...ids: string[]) => ids.map((id) => ({ saison_id: id }));

describe("the season the public club page shows a club in", () => {
  it("is the selected season where the public tier serves it and the club holds a row there", () => {
    assert.equal(publicTeamSaisonId(SAISONS, LAUFEND.id, inSaisons(LAUFEND.id)), LAUFEND.id);
    assert.equal(publicTeamSaisonId(SAISONS, VERGANGEN.id, inSaisons(VERGANGEN.id)), VERGANGEN.id);
  });

  /* The join is strict, so the page answers 404 for a club outside the season it shows, and a link
     offered there lands the admin on „nicht gefunden“. */
  it("is none where the club holds no row in the selected season", () => {
    assert.equal(publicTeamSaisonId(SAISONS, VERGANGEN.id, inSaisons(LAUFEND.id)), null);
  });

  /* The public tier redirects a planned season's id away, and the page then shows the running
     season — so that season, and the club's row in it, are what the link has to answer to. */
  it("is the running season where the selected one is still planned", () => {
    assert.equal(publicTeamSaisonId(SAISONS, GEPLANT.id, inSaisons(LAUFEND.id, GEPLANT.id)), LAUFEND.id);
  });

  it("is none for a club entered only into the planned season", () => {
    assert.equal(publicTeamSaisonId(SAISONS, GEPLANT.id, inSaisons(GEPLANT.id)), null);
  });

  /* Without a running season the public page has no default to fall back to and answers 404. */
  it("is none where no season is running to fall back to", () => {
    assert.equal(publicTeamSaisonId([VERGANGEN, GEPLANT], GEPLANT.id, inSaisons(VERGANGEN.id, GEPLANT.id)), null);
    assert.equal(publicTeamSaisonId([VERGANGEN, GEPLANT], undefined, inSaisons(VERGANGEN.id, GEPLANT.id)), null);
  });
});

const row = (publicSaisonId: string | null): AdminTeamRow => ({
  id: "68d0f2a4c1e2b3a4d5e6f701",
  name: "Goethe-Gymnasium",
  full_name: "Goethe-Gymnasium Frankfurt",
  shorthand: "GG",
  inactive_since: null,
  selected: { gruppe: "A", austritt: null },
  isRetireable: false,
  publicSaisonId,
});

/** The row's overflow menu, opened on the table while the selector names the planned season. */
async function openMenu(team: AdminTeamRow): Promise<HTMLElement> {
  render(
    h(AppRouterContext.Provider, {
      value: nextRouter(),
      children: h(SearchParamsContext.Provider, {
        value: new URLSearchParams(`saison_id=${GEPLANT.id}`),
        children: h(AdminTeamsTable, { filteredTeams: [team], emptiness: "none", setDeletingTeam: () => undefined }),
      }),
    }),
  );

  const table = screen.getByRole("grid", { name: "Tabelle aller Teams" });
  await userEvent.setup().click(within(table).getByRole("button", { name: `Weitere Aktionen für Team ${team.name}` }));

  return screen.getByRole("menu");
}

describe("the club list's link into the public club page", () => {
  /* The wiring between the row's field and the menu item: a link composed from the selector's season
     instead reopens both defects `publicTeamSaisonId` closes. */
  it("carries the season the public page shows the club in, not the one the selector names", async () => {
    const menu = await openMenu(row(VERGANGEN.id));

    assert.equal(
      within(menu).getByRole("menuitem", { name: "Öffentliche Teamseite" }).getAttribute("href"),
      `/dashboard/teams/68d0f2a4c1e2b3a4d5e6f701?saison_id=${VERGANGEN.id}`,
    );
  });

  it("is not offered where the public page shows the club in no season", async () => {
    const menu = await openMenu(row(null));

    assert.ok(within(menu).queryAllByRole("menuitem").length > 0, "the open menu holds no item at all, so the absence below proves nothing");
    assert.ok(within(menu).queryByRole("menuitem", { name: "Öffentliche Teamseite" }) === null, "the menu offers the public page");
  });
});
