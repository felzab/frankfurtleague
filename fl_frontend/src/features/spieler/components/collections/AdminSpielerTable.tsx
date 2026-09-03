"use client";

import { memo, useTransition } from "react";
import { useSearchParams } from "next/navigation";

import { Pencil, Person, Persons } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { reactivateSaisonSpielerAction, reactivateSpielerAction } from "@/features/spieler/actions";
import { LIST_REACTIVATION_NEEDS_A_TEAM_IN_SAISON, rolleKuerzel, rolleLabel } from "@/features/spieler/constants";
import { SHORTHAND_CHIP } from "@/features/spieler/shorthandChip";
import { TEAMS_ANY_SAISON_QUERY } from "@/features/teams/facets";
import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { InfoHint } from "@/shared/components/ui/InfoHint";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
import { RowActionDelete, RowActionLink, RowActionRestore, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";
import { withSaisonId } from "@/shared/utils/saisonHref";

import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";
import type { AdminSpielerRow, SpielerTeamOption } from "../../types";

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: "Keine Spieler für diese Suche.",
  filtered: "Keine Spieler für diese Filter.",
  none: "Es wurden noch keine Spieler angelegt.",
};

/**
 * Memoised, and load-bearing — `AdminCrudView`'s collection-identity note carries why.
 *
 * The rows are every player; Team, Nummer and Status are the SELECTED SEASON's.
 */
export const AdminSpielerTable = memo(function AdminSpielerTable({
  filteredSpieler,
  emptiness,
  saisonTeams,
  selectedSaisonId,
  setDeletingSpieler,
}: {
  filteredSpieler: AdminSpielerRow[];
  /** `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` carries what each value means. */
  emptiness: CrudEmptiness;
  /** The clubs holding a junction row in the selected season — the one collection `REQ-SQUAD-001` counts. */
  saisonTeams: readonly SpielerTeamOption[];
  /** Which season the squad columns describe — the sidemenu selector's, resolved by the page. */
  selectedSaisonId: string;
  setDeletingSpieler: (spieler: AdminSpielerRow) => void;
}) {
  const [, startReactivating] = useTransition();

  // The selector's season rides along on every row link, so the editor opens on the season shown.
  const searchParams = useSearchParams();
  const selectedFromUrl = searchParams.get("saison_id");

  // No confirmation step: reactivation is undone by the delete control that takes its place.
  const handleReactivatePerson = (spieler: AdminSpielerRow) => {
    startReactivating(async () => {
      const res = await reactivateSpielerAction({ id: spieler.id });
      if (res.success) appToast.success(res.message ?? "Spieler reaktiviert");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error ?? UNKNOWN_REFUSAL });
    });
  };

  const handleReactivateRow = (spieler: AdminSpielerRow) => {
    startReactivating(async () => {
      const res = await reactivateSaisonSpielerAction({ spieler_id: spieler.id, saison_id: selectedSaisonId });
      if (res.success) appToast.success(res.message ?? "Kadereintrag reaktiviert. Nummer, Position und Stufe sind wiederhergestellt.");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error ?? UNKNOWN_REFUSAL });
    });
  };

  // One source for both layouts, so the table and the phone cards cannot disagree about a row's state.
  const renderStatusBadges = (spieler: AdminSpielerRow) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {spieler.inactive_since !== null && <RetiredBadge since={spieler.inactive_since} />}
      {spieler.selected === null && <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Nicht im Kader</span>}
      {spieler.selected?.inactive_since != null && (
        <span className={`${LABEL_BADGE} bg-warning/15 text-warning-strong`}>
          Ausgetragen seit {formatSpielDatum(spieler.selected.inactive_since)}
        </span>
      )}
      {spieler.inactive_since === null && spieler.selected !== null && spieler.selected.inactive_since === null && (
        /* The ROW's standing, never the season's status: it holds only while the person, the squad
           row and the season entry are all live, so it is narrower than
           `fl_frontend/src/features/spieler/facets.ts`'s „Person“ bucket. */
        <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Aktiv</span>
      )}
      {spieler.selected?.is_nachgetragen === true && spieler.selected.inactive_since === null && (
        <span className={`${LABEL_BADGE} bg-info/15 text-info-strong`}>Nachgetragen</span>
      )}
    </div>
  );

  // Two independent retirements meet here: the trash retires the PERSON, the restore above it the
  // SQUAD ROW. A row can be in either state, both, or neither.
  const renderActions = (spieler: AdminSpielerRow) => {
    const row = spieler.selected;
    // `REQ-SQUAD-001` asked of the row's STORED club, the editor's gate from the list: a club
    // replacement takes a club out of the season and leaves the squad rows still naming it.
    const isRowTeamInSaison = row === null || saisonTeams.some((team) => team.teamId === row.team_id);
    const rowBlockedReason = isRowTeamInSaison ? null : LIST_REACTIVATION_NEEDS_A_TEAM_IN_SAISON;

    return (
      <RowActions>
        {/* The club list narrows by `q=` and by no id, so the name is what the link can carry. Its Saison
            facet is on by default and a squad row can name a club the season no longer holds, so the link
            turns that facet off. */}
        {row !== null && row.teamName !== null && (
          <RowActionLink
            href={withSaisonId(`/admin/teams?q=${encodeURIComponent(row.teamName)}&${TEAMS_ANY_SAISON_QUERY}`, selectedFromUrl)}
            label="Team anzeigen"
            ariaLabel={`Team ${row.teamName} anzeigen`}>
            <Persons
              aria-hidden="true"
              width={18}
              height={18}
            />
          </RowActionLink>
        )}

        <RowActionLink
          href={withSaisonId(`/admin/spieler/${spieler.id}`, selectedFromUrl)}
          label="Bearbeiten"
          ariaLabel={`Spieler ${spieler.fullName} bearbeiten`}>
          <Pencil
            aria-hidden="true"
            width={18}
            height={18}
          />
        </RowActionLink>

        {/* The SQUAD ROW's restore — a different endpoint, and it preserves number, position and stufe. */}
        {row?.inactive_since != null && (
          <RowActionRestore
            label="Kadereintrag reaktivieren"
            ariaLabel={`Kadereintrag von ${spieler.fullName} reaktivieren`}
            disabledReason={rowBlockedReason}
            onPress={() => handleReactivateRow(spieler)}
          />
        )}

        {/* The PERSON's own reactivate takes no gate: `POST /spieler/{id}/reactivate` clears the date
            and refuses nothing. */}
        {spieler.inactive_since !== null ? (
          <RowActionRestore
            label="Spieler reaktivieren"
            ariaLabel={`Spieler ${spieler.fullName} reaktivieren`}
            onPress={() => handleReactivatePerson(spieler)}
          />
        ) : (
          <RowActionDelete
            label="Stilllegen"
            ariaLabel={`Spieler ${spieler.fullName} stilllegen`}
            onPress={() => setDeletingSpieler(spieler)}
          />
        )}
      </RowActions>
    );
  };

  const renderRolle = (spieler: AdminSpielerRow) => {
    const rolle = spieler.selected?.rolle;

    return rolle == null ? null : (
      <span className={`${LABEL_BADGE} bg-brand-solid text-brand-solid-foreground shrink-0`}>{rolleLabel(rolle)}</span>
    );
  };

  /**
   * The phone layout's marker, in the Kürzel chip's exact box. The letters rather than the word — the
   * markers the squad sheets already used — with the hint carrying it for anyone who does not know them.
   */
  const renderRolleCompact = (spieler: AdminSpielerRow) => {
    const rolle = spieler.selected?.rolle;
    if (rolle == null) return null;

    const label = `${rolleLabel(rolle)} dieses Teams`;

    return (
      <InfoHint
        label={label}
        trigger={<span className={SHORTHAND_CHIP}>{rolleKuerzel(rolle)}</span>}>
        <p>{label}</p>
      </InfoHint>
    );
  };

  /**
   * EMPTY rather than absent when the player has none: a missing chip leaves a ragged hole in the
   * column and reads as a rendering fault rather than as "not filled in".
   */
  const renderNummer = (spieler: AdminSpielerRow) => (
    <span
      aria-label={spieler.selected?.nummer ? undefined : "Keine Nummer"}
      // A fixed height rather than padding: `py-1.5` sizes the chip from its line box, and an empty
      // span has none, so the empty chip would collapse.
      className={`fluid-xs inline-flex h-7 w-10 shrink-0 items-center justify-center rounded-md font-extrabold tracking-wide ${
        spieler.selected?.nummer ? "bg-muted text-foreground" : "bg-muted/50"
      }`}>
      {spieler.selected?.nummer ?? ""}
    </span>
  );

  return (
    <>
      {/* The table below `md` forced the whole grid sideways; a stacked card holds the same data and
          the same controls at reading width. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredSpieler.length === 0 && <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />}
        {filteredSpieler.map((spieler) => (
          <div
            key={spieler.id}
            className={`${card()} flex w-full flex-col gap-y-3 p-4 ${spieler.inactive_since !== null ? "opacity-80" : ""}`}>
            <div className="flex w-full flex-row items-center gap-3">
              {renderNummer(spieler)}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="fluid-sm text-foreground truncate font-semibold">{spieler.fullName}</span>
                <span className="fluid-xs text-foreground-muted truncate">
                  {spieler.selected?.teamName ?? "Kein Team in dieser Saison"}
                  {spieler.selected?.position ? ` · ${spieler.selected.position}` : ""}
                  {spieler.selected?.stufe ? ` · ${spieler.selected.stufe}` : ""}
                </span>
              </div>
              {renderRolleCompact(spieler)}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">{renderStatusBadges(spieler)}</div>
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(spieler)}</div>
          </div>
        ))}
      </div>

      <div className="hidden w-full md:block">
        <Table className={`${card()} h-fit w-full p-0`}>
          {/* No `scrollbar-hide`: below the minimum declared on the table this container is the
              only way to reach the columns it cannot fit, and a hidden bar says it is not. */}
          <Table.ScrollContainer>
            {/* Fixed layout holds the columns when the rows go. The minimum is the five declared
                columns plus 176 each for the two free-text ones, under which they get nothing. */}
            <Table.Content
              aria-label="Tabelle aller Spieler"
              className="min-w-5xl table-fixed">
              <Table.Header>
                {/* UNDECLARED, and so is Team: fixed layout splits what the declared columns leave
                equally between them, which is the only pair here holding free text. */}
                <Table.Column
                  isRowHeader
                  className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Spieler
                </Table.Column>
                {/* Declared to the column's content or to its own heading, whichever is wider:
                under fixed layout a surplus here comes out of the two free-text columns rather than
                going unused. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-16 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Nr.
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Team
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-28 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Position
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-20 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Stufe
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-44 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Status
                </Table.Column>
                {/* Four controls at most — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`
                holds the arithmetic, and it is the count a new action changes. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-60 border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
                  Aktionen
                </Table.Column>
              </Table.Header>

              {/* `items` + a render function, not mapped children — see the memo note above. */}
              <Table.Body
                items={filteredSpieler}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(spieler: AdminSpielerRow) => {
                  const isRetired = spieler.inactive_since !== null;
                  return (
                    <Table.Row
                      id={spieler.id}
                      className="border-border/50 border-b last:border-b-0">
                      <Table.Cell className="px-6 py-4">
                        <div className={`flex min-w-0 items-center gap-3 ${isRetired ? "opacity-60" : ""}`}>
                          <Person
                            className="text-brand shrink-0"
                            width={18}
                            height={18}
                          />
                          <span className="fluid-sm text-foreground truncate font-semibold">{spieler.fullName}</span>
                          {renderRolle(spieler)}
                        </div>
                      </Table.Cell>

                      <Table.Cell className="px-3 py-4">{renderNummer(spieler)}</Table.Cell>

                      <Table.Cell className="px-3 py-4">
                        {spieler.selected?.teamName ? (
                          <div className="flex items-center gap-2">
                            {/* The TeamCard's chip colour, so a Kürzel wears one tint everywhere. */}
                            <span className={SHORTHAND_CHIP}>{spieler.selected.teamShorthand}</span>
                            <span className="fluid-sm text-foreground truncate font-semibold">{spieler.selected.teamName}</span>
                          </div>
                        ) : null}
                      </Table.Cell>

                      <Table.Cell className="px-3 py-4">
                        {spieler.selected?.position ? (
                          <span className="fluid-sm text-foreground font-semibold">{spieler.selected.position}</span>
                        ) : null}
                      </Table.Cell>

                      <Table.Cell className="px-3 py-4">
                        {spieler.selected?.stufe ? (
                          <span className="fluid-sm text-foreground font-semibold">{spieler.selected.stufe}</span>
                        ) : null}
                      </Table.Cell>

                      <Table.Cell className="px-3 py-4">{renderStatusBadges(spieler)}</Table.Cell>

                      <Table.Cell className="px-6 py-4">{renderActions(spieler)}</Table.Cell>
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
