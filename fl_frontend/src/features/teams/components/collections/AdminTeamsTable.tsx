"use client";

import { memo, useTransition } from "react";
import { useSearchParams } from "next/navigation";

import { Envelope, Globe, Magnifier, Pencil, PersonPencil } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { SHORTHAND_CHIP } from "@/features/spieler/shorthandChip";
import { reactivateTeamAction } from "@/features/teams/actions";
import { austrittZustand } from "@/features/teams/constants";
import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import {
  CELL_EDGE,
  CELL_INNER,
  COLUMN_EDGE,
  COLUMN_INNER,
  IDENTITY_HEAD,
  IDENTITY_LINE,
  IDENTITY_NAME,
  IDENTITY_ROW,
  IDENTITY_STACK,
  TABLE_HEADING,
} from "@/shared/components/ui/adminTable";
import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
import {
  RowActionDelete,
  RowActionLink,
  RowActionMenu,
  RowActionMenuItem,
  RowActionRestore,
  RowActions,
} from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { withSaisonId } from "@/shared/utils/saisonHref";

import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";
import type { AdminTeamRow } from "../../types";

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: "Keine Teams für diese Suche.",
  filtered: "Keine Teams für diese Filter.",
  none: "Es wurden noch keine Teams angelegt.",
};

/**
 * Memoised, and load-bearing — `AdminCrudView`'s collection-identity note carries why.
 *
 * The rows are every club; Gruppe and Status are the SELECTED SEASON's.
 */
export const AdminTeamsTable = memo(function AdminTeamsTable({
  filteredTeams,
  emptiness,
  setDeletingTeam,
}: {
  filteredTeams: AdminTeamRow[];
  /** `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` carries what each value means. */
  emptiness: CrudEmptiness;
  setDeletingTeam: (team: AdminTeamRow) => void;
}) {
  const [, startReactivating] = useTransition();

  // The selector's season rides along on every row link, so each destination opens on the season
  // this list is showing.
  const searchParams = useSearchParams();
  const selectedFromUrl = searchParams.get("saison_id");
  // The season the shell is on, handed to `withSaisonId`: it resolves the `?`/`&` split with
  // `URLSearchParams`, which is the whole reason the two hand-rolled constants existed.

  // No confirmation step: reactivation is undone by the delete control that takes its place.
  const handleReactivate = (team: AdminTeamRow) => {
    startReactivating(async () => {
      const res = await reactivateTeamAction({ id: team.id });
      if (res.success) appToast.success("Team reaktiviert");
      else appToast.danger("Team nicht reaktiviert", { description: res.error });
    });
  };

  // One source for both layouts, so the table and the phone cards cannot disagree about a row's state.
  const renderStatusBadges = (team: AdminTeamRow) => (
    <div className="flex flex-wrap items-center gap-2">
      {team.inactive_since !== null && <RetiredBadge since={team.inactive_since} />}
      {/* An absence and not an exit: a club nobody took into the season takes the label tone, where
          the two Austritt words beside it grade a club that was in it and left. */}
      {team.selected === null && <span className={labelBadge("info")}>Nicht aufgenommen</span>}
      {team.selected?.austritt != null && <span className={labelBadge("danger")}>{austrittZustand(team.selected.austritt.type)}</span>}
      {team.inactive_since === null && team.selected !== null && team.selected.austritt === null && (
        /* The CLUB's standing, never the season's status: `fl_frontend/src/features/teams/facets.ts`'s
           `aktiv` bucket is this same state and ignores the season's tense, so the filter and the
           row cannot disagree. */
        <span className={labelBadge("success")}>Aktiv</span>
      )}
    </div>
  );

  /**
   * The Kürzel is the club's identity token rather than a column, as every other surface sets it
   * (`fl_frontend/src/features/teams/components/ui/TeamCard.tsx`). The pills join the name's line: a
   * column wide enough for „Stillgelegt 09.09.2026“ leaves the name almost nothing.
   */
  const renderIdentity = (team: AdminTeamRow, dimmed: boolean) => (
    <div className={`${IDENTITY_ROW} ${dimmed ? "opacity-60" : ""}`}>
      <span className={SHORTHAND_CHIP}>{team.shorthand}</span>
      <div className={IDENTITY_STACK}>
        <div className={IDENTITY_HEAD}>
          <span className={IDENTITY_NAME}>{team.name}</span>
          {renderStatusBadges(team)}
        </div>
        <span className={IDENTITY_LINE}>{team.full_name}</span>
      </div>
    </div>
  );

  const renderGruppe = (team: AdminTeamRow) =>
    team.selected ? <span className="fluid-sm text-foreground font-semibold">{team.selected.gruppe}</span> : null;

  const renderActions = (team: AdminTeamRow) => (
    <RowActions>
      <RowActionLink
        href={withSaisonId(`/admin/teams/${team.id}`, selectedFromUrl)}
        label="Bearbeiten"
        ariaLabel={`Team ${team.name} bearbeiten`}>
        <Pencil
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      {team.inactive_since !== null ? (
        <RowActionRestore
          label="Reaktivieren"
          ariaLabel={`Team ${team.name} reaktivieren`}
          onPress={() => handleReactivate(team)}
        />
      ) : (
        /* Present but DISABLED where the write path would refuse (`REQ-RETIRE-001`), so the rule is
           discoverable rather than a mystery. */
        <RowActionDelete
          disabledReason={
            team.isRetireable ? null : "Stilllegen ist nur möglich, wenn das Team in keiner laufenden oder geplanten Saison spielt."
          }
          label="Stilllegen"
          ariaLabel={`Team ${team.name} stilllegen`}
          onPress={() => setDeletingTeam(team)}
        />
      )}
      {/* All four leave the row for another list or page, and as inline icons they put six controls
          in a row that has 631px for everything. */}
      <RowActionMenu ariaLabel={`Weitere Aktionen für Team ${team.name}`}>
        {/* `team` as `buildSpielerFacets` declares it, keyed by the club's id. The season's own clubs
            are that facet's options, so a club outside the season drops out and the link widens. */}
        <RowActionMenuItem
          id="spieler"
          href={withSaisonId(`/admin/spieler?team=${team.id}`, selectedFromUrl)}
          label="Spieler anzeigen">
          <PersonPencil className="text-foreground-muted size-4" />
        </RowActionMenuItem>
        {/* `team` as `buildKontakteFacets` declares it, and the season rides along beside it: the seats
            hang off the junction, so without it this opens another season's three people. */}
        <RowActionMenuItem
          id="kontakte"
          href={withSaisonId(`/admin/kontakte?team=${team.id}`, selectedFromUrl)}
          label="Kontakte anzeigen">
          <Envelope className="text-foreground-muted size-4" />
        </RowActionMenuItem>
        {/* `team` as `buildSpielFacets` declares it, and it reads both sides — so this finds the club's
            fixtures whichever slot it occupies. */}
        <RowActionMenuItem
          id="spiele"
          href={withSaisonId(`/admin/spielsuche?team=${team.id}`, selectedFromUrl)}
          label="Spiele anzeigen">
          <Magnifier className="text-foreground-muted size-4" />
        </RowActionMenuItem>
        <RowActionMenuItem
          id="oeffentlich"
          href={withSaisonId(`/dashboard/teams/${team.id}`, selectedFromUrl)}
          label="Öffentliche Teamseite">
          <Globe className="text-foreground-muted size-4" />
        </RowActionMenuItem>
      </RowActionMenu>
    </RowActions>
  );

  return (
    <>
      {/* The table below `md` forced the whole grid sideways; a stacked card holds the same data and
          the same controls at reading width. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredTeams.length === 0 && <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />}
        {filteredTeams.map((team) => (
          <div
            key={team.id}
            className={`${card()} flex w-full flex-col gap-y-3 p-4 ${team.inactive_since !== null ? "opacity-80" : ""}`}>
            {/* Undimmed: the card dims its whole box, so a second grade inside it would compound. */}
            {renderIdentity(team, false)}
            {team.selected && <span className="fluid-sm text-foreground shrink-0 font-semibold">Gruppe {team.selected.gruppe}</span>}
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(team)}</div>
          </div>
        ))}
      </div>

      <div className="hidden w-full md:block">
        <Table className={`${card()} h-fit w-full p-0`}>
          {/* Never scrolled at a width this table renders at
              (`fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`). It stays for a platform
              scrollbar wider than the step allows for and for text zoom, where a clipped column would
              hide a cell a bar reaches. */}
          <Table.ScrollContainer>
            {/* Fixed layout holds the columns when the rows go, and the minimum is what the declared
                columns plus the Team allowance come to. */}
            <Table.Content
              aria-label="Tabelle aller Teams"
              className="min-w-156 table-fixed">
              <Table.Header>
                {/* UNDECLARED: fixed layout gives it everything the columns beside it leave, and it
                is the only one here holding free text. */}
                <Table.Column
                  isRowHeader
                  className={`${TABLE_HEADING} ${COLUMN_EDGE}`}>
                  Team
                </Table.Column>
                {/* The season's one fact about a club that a reader scans down the page, so it keeps
                    a column; `w-24` is its heading's width, which runs wider than any group letter. */}
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_INNER} w-24`}>Gruppe</Table.Column>
                {/* Three controls — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`
                holds the arithmetic, and it is the count a new action changes. */}
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_EDGE} w-48 text-right`}>Aktionen</Table.Column>
              </Table.Header>

              {/* `items` + a render function, not mapped children — see the memo note above. */}
              <Table.Body
                items={filteredTeams}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(team: AdminTeamRow) => (
                  <Table.Row
                    id={team.id}
                    className="border-border/50 border-b last:border-b-0">
                    <Table.Cell className={CELL_EDGE}>{renderIdentity(team, team.inactive_since !== null)}</Table.Cell>

                    <Table.Cell className={CELL_INNER}>{renderGruppe(team)}</Table.Cell>

                    <Table.Cell className={CELL_EDGE}>{renderActions(team)}</Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>
    </>
  );
});
