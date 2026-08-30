"use client";

import { memo, useTransition } from "react";
import { useSearchParams } from "next/navigation";

import { Envelope, Globe, Magnifier, Pencil, PersonPencil, Persons } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { reactivateTeamAction } from "@/features/teams/actions";
import { austrittZustand } from "@/features/teams/constants";
import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionDelete, RowActionLink, RowActionRestore, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

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
  const saisonQuery = selectedFromUrl ? `?saison_id=${encodeURIComponent(selectedFromUrl)}` : "";
  // The same value as a second parameter, for the one row link that carries a facet of its own.
  const saisonParam = selectedFromUrl ? `&saison_id=${encodeURIComponent(selectedFromUrl)}` : "";

  // No confirmation step: reactivation is undone by the delete control that takes its place.
  const handleReactivate = (team: AdminTeamRow) => {
    startReactivating(async () => {
      const res = await reactivateTeamAction({ id: team.id });
      if (res.success) appToast.success(res.message ?? "Team reaktiviert");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error ?? UNKNOWN_REFUSAL });
    });
  };

  // One source for both layouts, so the table and the phone cards cannot disagree about a row's state.
  const renderStatusBadges = (team: AdminTeamRow) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {team.inactive_since !== null && (
        <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Stillgelegt seit {formatSpielDatum(team.inactive_since)}</span>
      )}
      {team.selected === null && <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Nicht aufgenommen</span>}
      {team.selected?.austritt != null && (
        <span className={`${LABEL_BADGE} bg-danger/15 text-danger-strong`}>{austrittZustand(team.selected.austritt.type)}</span>
      )}
      {team.inactive_since === null && team.selected !== null && team.selected.austritt === null && (
        /* The CLUB's standing, never the season's status: `fl_frontend/src/features/teams/facets.ts`'s
           `aktiv` bucket is this same state and ignores the season's tense, so the filter and the
           row cannot disagree. */
        <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Aktiv</span>
      )}
    </div>
  );

  const renderActions = (team: AdminTeamRow) => (
    <RowActions>
      {/* `team` as `buildSpielerFacets` declares it, keyed by the club's id. The season's own clubs
          are that facet's options, so a club outside the season drops out and the link widens. */}
      <RowActionLink
        href={`/admin/spieler?team=${team.id}${saisonParam}`}
        label="Spieler anzeigen"
        ariaLabel={`Spieler von ${team.name} anzeigen`}>
        <PersonPencil
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      {/* `team` as `buildKontakteFacets` declares it, and the season rides along beside it: the seats
          hang off the junction, so without it this opens another season's three people. */}
      <RowActionLink
        href={`/admin/kontakte?team=${team.id}${saisonParam}`}
        label="Kontakte anzeigen"
        ariaLabel={`Kontakte von ${team.name} anzeigen`}>
        <Envelope
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      {/* `team` as `buildSpielFacets` declares it, and it reads both sides — so this finds the club's
          fixtures whichever slot it occupies. */}
      <RowActionLink
        href={`/admin/spielsuche?team=${team.id}${saisonParam}`}
        label="Spiele anzeigen"
        ariaLabel={`Spiele von ${team.name} anzeigen`}>
        <Magnifier
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      <RowActionLink
        href={`/dashboard/teams/${team.id}${saisonQuery}`}
        label="Öffentliche Teamseite"
        ariaLabel={`Öffentliche Seite von ${team.name} öffnen`}>
        <Globe
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      <RowActionLink
        href={`/admin/teams/${team.id}${saisonQuery}`}
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
            <div className="flex w-full flex-row items-center gap-3">
              <span className="bg-brand-solid text-brand-solid-foreground fluid-xs inline-flex w-14 shrink-0 items-center justify-center rounded-md py-1.5 font-extrabold tracking-wide shadow-sm">
                {team.shorthand}
              </span>
              <div className="flex min-w-0 flex-col">
                <span className="fluid-sm text-foreground truncate font-semibold">{team.name}</span>
                <span className="fluid-xs text-foreground-muted truncate">{team.full_name}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {team.selected && <span className="fluid-sm text-foreground shrink-0 font-semibold">Gruppe {team.selected.gruppe}</span>}
              {renderStatusBadges(team)}
            </div>
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(team)}</div>
          </div>
        ))}
      </div>

      <div className="hidden w-full md:block">
        <Table className={`${card()} h-fit w-full p-0`}>
          {/* No `scrollbar-hide`: below the minimum declared on the table this container is the
              only way to reach the columns it cannot fit, and a hidden bar says it is not. */}
          <Table.ScrollContainer>
            {/* Fixed layout holds the columns when the rows go. The minimum is the four declared
                columns plus 256 for the free-text one, under which it gets nothing. */}
            <Table.Content
              aria-label="Tabelle aller Teams"
              /* A numeric step rather than a container name: six controls put the owed floor at 944px,
                  which no `--container-*` names. `adminCrudEmpty.test.ts` resolves both scales. */
              className="min-w-236 table-fixed">
              <Table.Header>
                {/* UNDECLARED: fixed layout gives it everything the columns beside it leave, and it
                is the only one here holding free text. */}
                <Table.Column
                  isRowHeader
                  className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Team
                </Table.Column>
                {/* Declared to the column's content or to its own heading, whichever is wider:
                under fixed layout a surplus here comes out of the name column rather than going
                unused. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-24 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Kürzel
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-24 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Gruppe
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-40 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Status
                </Table.Column>
                {/* Five controls at most — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`
                holds the arithmetic, and it is the count a new action changes. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-84 border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
                  Aktionen
                </Table.Column>
              </Table.Header>

              {/* `items` + a render function, not mapped children — see the memo note above. */}
              <Table.Body
                items={filteredTeams}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(team: AdminTeamRow) => {
                  const isRetired = team.inactive_since !== null;
                  return (
                    <Table.Row
                      id={team.id}
                      className="border-border/50 border-b last:border-b-0">
                      <Table.Cell className="px-6 py-4">
                        <div className={`flex items-center gap-3 ${isRetired ? "opacity-60" : ""}`}>
                          <Persons
                            className="text-brand shrink-0"
                            width={18}
                            height={18}
                          />
                          <div className="flex flex-col gap-0.5">
                            <span className="fluid-sm text-foreground font-semibold">{team.name}</span>
                            <span className="fluid-xs text-foreground-muted">{team.full_name}</span>
                          </div>
                        </div>
                      </Table.Cell>

                      <Table.Cell className="px-3 py-4">
                        {/* The TeamCard's chip colour, so a Kürzel wears one tint everywhere. Fixed
                        width, sized to the widest pair, so the column stops wobbling between rows. */}
                        <span className="bg-brand-solid text-brand-solid-foreground fluid-xs inline-flex w-14 items-center justify-center rounded-md py-1.5 font-extrabold tracking-wide shadow-sm">
                          {team.shorthand}
                        </span>
                      </Table.Cell>

                      <Table.Cell className="px-3 py-4">
                        {team.selected ? <span className="fluid-sm text-foreground font-semibold">{team.selected.gruppe}</span> : null}
                      </Table.Cell>

                      <Table.Cell className="px-3 py-4">{renderStatusBadges(team)}</Table.Cell>

                      <Table.Cell className="px-6 py-4">{renderActions(team)}</Table.Cell>
                    </Table.Row>
                  );
                }}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>
    </>
  );
});
