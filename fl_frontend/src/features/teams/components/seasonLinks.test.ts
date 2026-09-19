import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";

import type { FLGruppenTeam, FLTeam } from "@/features/teams/schemas.ts";
import type { ReactNode } from "react";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { TeamsGrid } = await import("./collections/TeamsGrid.tsx");
const { TeamPopoverMenu } = await import("./ui/TeamPopoverMenu.tsx");
const { SaisontabelleView } = await import("./views/SaisontabelleView.tsx");
const { TeamDetailsBackButton } = await import("./ui/TeamDetailsBackButton.tsx");
const { TeamSpielerView } = await import("@/features/spieler/components/views/TeamSpielerView.tsx");
const { SpielTeamSlot } = await import("@/features/spiele/components/ui/SpielTeamSlot.tsx");

/** Where a press sends the reader, recorded. */
const { router, seen } = recordingRouter();

const renderUnderRouter = (tree: ReactNode) => render(underNext(tree, { router }));

const VERGANGEN = "2025";
const TEAM_ID = "6780e194677bfbfb5ea8396c";

const STATISTIK = {
  anzahl_gespielte_spiele: 3,
  siege: 1,
  niederlagen: 1,
  unentschieden: 1,
  tore_geschossen: 4,
  tore_kassiert: 4,
  punkte: 4,
  anzahl_abgesagte_spiele: 0,
};

const TEAM: FLTeam = {
  id: TEAM_ID,
  name: "Mainufer Beispiel",
  gruppe: "A",
  statistik: STATISTIK,
  austritt: null,
  shorthand: "QM",
  description: "",
  full_name: "Mainufer Beispielschule",
  website_url: null,
  address: { strasse: "Uferweg", hausnummer: "1", plz: "60528", stadtteil: "Niederrad", stadt: "Frankfurt am Main" },
  schulform: null,
  inactive_since: null,
};

const GRUPPEN_TEAM: FLGruppenTeam = {
  id: TEAM_ID,
  name: "Mainufer Beispiel",
  shorthand: "QM",
  statistik: STATISTIK,
  austritt_type: null,
  anzahl_ausstehende_spiele: 0,
};

/** The two links a club's popover offers, read after pressing the club's name. */
async function popoverHrefs(trigger: HTMLElement): Promise<(string | null)[]> {
  await userEvent.setup().click(trigger);

  return [screen.getByRole("link", { name: "Team-Details" }), screen.getByRole("link", { name: "Kader" })].map((link) =>
    link.getAttribute("href"),
  );
}

describe("the club grids' links into a club", () => {
  /* The bare club page joins the RUNNING season strictly, so it answers „nicht gefunden“ for a club
     that played only a past one: a list read for a past season has to carry that season in its links. */
  it("carry the season the list was read for", () => {
    for (const urlPrefix of ["/dashboard/teams", "/dashboard/spieler"]) {
      const { unmount } = renderUnderRouter(h(TeamsGrid, { teams: [TEAM], urlPrefix, saisonId: VERGANGEN, isFinishedSaison: true }));

      assert.equal(screen.getByRole("link").getAttribute("href"), `${urlPrefix}/${TEAM_ID}?saison_id=${VERGANGEN}`);
      unmount();
    }
  });

  it("stay bare where the list shows the running season", () => {
    renderUnderRouter(h(TeamsGrid, { teams: [TEAM], urlPrefix: "/dashboard/teams", saisonId: undefined, isFinishedSaison: false }));

    assert.equal(screen.getByRole("link").getAttribute("href"), `/dashboard/teams/${TEAM_ID}`);
  });
});

describe("the club popover's two links", () => {
  /* The three match cards share `SpielTeamSlot`, and each hands it the fixture's own season: a card on a past
     season's fixture otherwise opens its clubs in the running one. */
  it("carry the season of the fixture a match card's side names", async () => {
    renderUnderRouter(
      h(SpielTeamSlot, {
        team: { team_id: TEAM_ID, tore: 1, name: TEAM.name, shorthand: TEAM.shorthand, austritt_type: null },
        quelle: null,
        saisonId: VERGANGEN,
        text: TEAM.name,
        className: "",
      }),
    );

    assert.deepEqual(await popoverHrefs(screen.getByRole("button", { name: TEAM.name })), [
      `/dashboard/teams/${TEAM_ID}?saison_id=${VERGANGEN}`,
      `/dashboard/spieler/${TEAM_ID}?saison_id=${VERGANGEN}`,
    ]);
  });

  // The about page's chips name no season of their own, and the running one is what they list.
  it("stay bare where no season is handed in", async () => {
    renderUnderRouter(
      h(TeamPopoverMenu, {
        teamName: TEAM.name,
        teamId: TEAM_ID,
        teamAustritt: null,
        saisonId: undefined,
        children: h("span", null, TEAM.name),
      }),
    );

    assert.deepEqual(await popoverHrefs(screen.getByRole("button", { name: TEAM.name })), [
      `/dashboard/teams/${TEAM_ID}`,
      `/dashboard/spieler/${TEAM_ID}`,
    ]);
  });

  it("carry the Saisontabelle's season", async () => {
    renderUnderRouter(
      h(SaisontabelleView, { gruppenData: { A: [GRUPPEN_TEAM] }, qualifiersPerGroup: 1, saisonId: VERGANGEN, isFinishedSaison: true }),
    );

    const [trigger] = screen.getAllByRole("button", { name: new RegExp(TEAM.name) });
    assert.deepEqual(await popoverHrefs(trigger ?? assert.fail("the table names no club")), [
      `/dashboard/teams/${TEAM_ID}?saison_id=${VERGANGEN}`,
      `/dashboard/spieler/${TEAM_ID}?saison_id=${VERGANGEN}`,
    ]);
  });
});

describe("the Saisontabelle's copy", () => {
  const tabelle = (gruppenTeams: Record<string, FLGruppenTeam[]>, isFinishedSaison: boolean): string => {
    const { container, unmount } = renderUnderRouter(
      h(SaisontabelleView, { gruppenData: gruppenTeams, qualifiersPerGroup: 1, saisonId: VERGANGEN, isFinishedSaison }),
    );
    const text = container.textContent;
    unmount();
    return text;
  };

  /* A finished season's group phase is over, so its mark states where a club ended rather than where it
     currently stands, and its empty group and table promise nothing still to come. */
  it("words a finished season's marked place, empty group and empty table as over", () => {
    const overText = tabelle({ A: [GRUPPEN_TEAM] }, true);

    assert.ok(overText.includes("Hervorgehoben ist das Team, das die Gruppenphase auf einem KO-Runden-Platz beendet hat."), overText);
    assert.doesNotMatch(overText, /aktuell/);
    const emptyCases: [Record<string, FLGruppenTeam[]>, string][] = [
      [{ A: [] }, "Für diese Gruppe gibt es keine Teams."],
      [{}, "Für diese Saison gibt es keine Tabelle."],
    ];
    for (const [gruppenTeams, sentence] of emptyCases) {
      const text = tabelle(gruppenTeams, true);
      assert.ok(text.includes(sentence), text);
      assert.doesNotMatch(text, /\bnoch\b|Sobald/);
    }
  });

  it("keeps the running season's current place and its promise that the table is still to come", () => {
    assert.ok(tabelle({ A: [GRUPPEN_TEAM] }, false).includes("Hervorgehoben ist das Team, das aktuell auf einem KO-Runden-Platz steht."));
    assert.ok(tabelle({ A: [] }, false).includes("Für diese Gruppe sind noch keine Teams eingeteilt."));
    assert.ok(tabelle({}, false).includes("Für diese Saison gibt es noch keine Tabelle."));
  });
});

describe("the club grids' empty state", () => {
  const emptyCases = (isFinishedSaison: boolean): string =>
    renderUnderRouter(h(TeamsGrid, { teams: [], urlPrefix: "/dashboard/teams", saisonId: VERGANGEN, isFinishedSaison })).container.textContent;

  it("says a finished season holds no clubs, and promises none", () => {
    const text = emptyCases(true);

    assert.ok(text.includes("Für diese Saison gibt es keine Teams."), text);
    assert.doesNotMatch(text, /\bnoch\b|Sobald/);
  });

  it("promises the running season's clubs are still to come", () => {
    assert.ok(emptyCases(false).includes("Für diese Saison gibt es noch keine Teams."));
  });
});

describe("the club page's and the squad page's way back", () => {
  /** Where Zurück sends a cold entry, which has no history to go back through. */
  async function fallback(tree: ReactNode): Promise<string | undefined> {
    seen.pushed.length = 0;
    const { unmount } = renderUnderRouter(tree);
    await userEvent.setup().click(screen.getByRole("button", { name: "Zurück" }));
    unmount();
    return seen.pushed[0];
  }

  it("lands a cold entry on the list of the season the page shows", async () => {
    assert.equal(await fallback(h(TeamDetailsBackButton, { saisonId: VERGANGEN })), `/dashboard/teams?saison_id=${VERGANGEN}`);
    assert.equal(
      await fallback(h(TeamSpielerView, { teamName: TEAM.name, teamSpieler: [], saisonId: VERGANGEN, isFinishedSaison: true })),
      `/dashboard/spieler?saison_id=${VERGANGEN}`,
    );
  });

  it("lands it on the bare list where the page shows the running season", async () => {
    assert.equal(await fallback(h(TeamDetailsBackButton, { saisonId: undefined })), "/dashboard/teams");
  });
});

describe("the squad page's empty table", () => {
  it("says a finished season's club holds no squad, and keeps the running season's promise", () => {
    const emptyCases = (isFinishedSaison: boolean): string => {
      const { container, unmount } = renderUnderRouter(
        h(TeamSpielerView, { teamName: TEAM.name, teamSpieler: [], saisonId: VERGANGEN, isFinishedSaison }),
      );
      const text = container.textContent;
      unmount();
      return text;
    };

    assert.ok(emptyCases(true).includes("Für dieses Team gibt es keinen Kader."));
    assert.ok(emptyCases(false).includes("Für dieses Team ist noch kein Kader eingetragen."));
  });
});
