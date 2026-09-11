"use client";

import { memo, useTransition } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Pencil } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { reactivateSaisonSpielerAction, reactivateSpielerAction } from "@/features/spieler/actions";
import { LIST_REACTIVATION_NEEDS_A_TEAM_IN_SAISON, REACTIVATION_NEEDS_ROOM_IN_SQUAD, rolleLabel } from "@/features/spieler/constants";
import { TEAMS_ANY_SAISON_QUERY } from "@/features/teams/facets";
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
import { RowActionDelete, RowActionLink, RowActionRestore, RowActions } from "@/shared/components/ui/RowActions";
import { textLink } from "@/shared/components/ui/textLink";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";
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
      if (res.success) appToast.success("Spieler reaktiviert");
      else appToast.danger("Spieler nicht reaktiviert", { description: res.error });
    });
  };

  const handleReactivateRow = (spieler: AdminSpielerRow) => {
    startReactivating(async () => {
      const res = await reactivateSaisonSpielerAction({ spieler_id: spieler.id, saison_id: selectedSaisonId });
      if (res.success) appToast.success("Kadereintrag reaktiviert", { description: res.message });
      else appToast.danger("Kadereintrag nicht reaktiviert", { description: res.error });
    });
  };

  // One source for both layouts, so the table and the phone cards cannot disagree about a row's state.
  const renderStatusBadges = (spieler: AdminSpielerRow) => (
    <div className="flex flex-wrap items-center gap-2">
      {spieler.inactive_since !== null && <RetiredBadge since={spieler.inactive_since} />}
      {/* An absence and not an exit: a person with no squad row this season takes the label tone,
          where „ausgetragen“ beside it grades a row that was in the Kader and came out. */}
      {spieler.selected === null && <span className={labelBadge("info")}>Nicht im Kader</span>}
      {/* The widest pill the identity column seats, with no slack at the narrowest table width
          (`fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`): a word added here lands on
          the Position cell. */}
      {spieler.selected?.inactive_since != null && (
        <span className={labelBadge("warning")}>
          Ausgetragen&nbsp;<span className="font-numeric tabular-nums">{formatSpielDatum(spieler.selected.inactive_since)}</span>
        </span>
      )}
      {spieler.inactive_since === null && spieler.selected !== null && spieler.selected.inactive_since === null && (
        /* The ROW's standing, never the season's status: it holds only while the person, the squad
           row and the season entry are all live, so it is narrower than
           `fl_frontend/src/features/spieler/facets.ts`'s „Person“ bucket. */
        <span className={labelBadge("success")}>Aktiv</span>
      )}
      {spieler.selected?.is_nachgetragen === true && spieler.selected.inactive_since === null && (
        <span className={labelBadge("info")}>Nachgetragen</span>
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
    // `REQ-SQUAD-003` asked second, the order the endpoint asks it in: a full squad is not a fact
    // worth reporting about a club the season does not hold.
    const rowSquadFullReason =
      saisonTeams.find((team) => team.teamId === row?.team_id)?.isSquadFull === true ? REACTIVATION_NEEDS_ROOM_IN_SQUAD : null;

    return (
      <RowActions>
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
            disabledReason={rowBlockedReason ?? rowSquadFullReason}
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

    return rolle == null ? null : <span className={`${labelBadge("brandSolid")} shrink-0`}>{rolleLabel(rolle)}</span>;
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
      className={`font-numeric fluid-xs inline-flex h-7 w-10 shrink-0 items-center justify-center rounded-md font-extrabold tracking-wide tabular-nums ${
        spieler.selected?.nummer ? "bg-muted text-foreground" : "bg-muted/50"
      }`}>
      {spieler.selected?.nummer ?? ""}
    </span>
  );

  /**
   * The club's NAME is the way to its list, as the public league table already makes one pressable
   * (`fl_frontend/src/features/teams/components/views/SaisontabelleView.tsx`). A squad row can name a
   * club the season does not hold, so the link turns that facet off.
   */
  const renderTeam = (spieler: AdminSpielerRow) => {
    const row = spieler.selected;
    if (row?.teamName == null || row.teamName === "") return <span className={IDENTITY_LINE}>Kein Team in dieser Saison</span>;

    return (
      <Link
        href={withSaisonId(`/admin/teams?q=${encodeURIComponent(row.teamName)}&${TEAMS_ANY_SAISON_QUERY}`, selectedFromUrl)}
        className={`${textLink({ tone: "muted" })} fluid-xs max-w-full min-w-0 truncate`}>
        {row.teamName}
      </Link>
    );
  };

  const renderIdentity = (spieler: AdminSpielerRow, dimmed: boolean) => (
    <div className={`${IDENTITY_ROW} ${dimmed ? "opacity-60" : ""}`}>
      {renderNummer(spieler)}
      <div className={IDENTITY_STACK}>
        <div className={IDENTITY_HEAD}>
          <span className={IDENTITY_NAME}>{spieler.fullName}</span>
          {renderRolle(spieler)}
          {renderStatusBadges(spieler)}
        </div>
        {renderTeam(spieler)}
      </div>
    </div>
  );

  // Absent rather than punctuated where the row holds neither, so no card carries a stray separator.
  const renderKaderMeta = (spieler: AdminSpielerRow) => {
    const teile: string[] = [];
    if (spieler.selected?.position) teile.push(spieler.selected.position);
    if (spieler.selected?.stufe) teile.push(spieler.selected.stufe);

    return teile.length === 0 ? null : <span className="fluid-xs text-foreground-muted">{teile.join(" · ")}</span>;
  };

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
            {/* Undimmed: the card dims its whole box, so a second grade inside it would compound. */}
            {renderIdentity(spieler, false)}
            {renderKaderMeta(spieler)}
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(spieler)}</div>
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
                columns plus the Spieler allowance come to. */}
            <Table.Content
              aria-label="Tabelle aller Spieler"
              className="min-w-156 table-fixed">
              <Table.Header>
                {/* UNDECLARED: fixed layout gives it everything the columns beside it leave, and it
                is the only one here holding free text. */}
                <Table.Column
                  isRowHeader
                  className={`${TABLE_HEADING} ${COLUMN_EDGE}`}>
                  Spieler
                </Table.Column>
                {/* Both stay columns: they are what a squad view is scanned down, and a merged
                    „Position / Stufe“ heading is wider than the two of them together. */}
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_INNER} w-28`}>Position</Table.Column>
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_INNER} w-20`}>Stufe</Table.Column>
                {/* Three controls — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`
                holds the arithmetic, and it is the count a new action changes. */}
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_EDGE} w-48 text-right`}>Aktionen</Table.Column>
              </Table.Header>

              {/* `items` + a render function, not mapped children — see the memo note above. */}
              <Table.Body
                items={filteredSpieler}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(spieler: AdminSpielerRow) => (
                  <Table.Row
                    id={spieler.id}
                    className="border-border/50 border-b last:border-b-0">
                    <Table.Cell className={CELL_EDGE}>{renderIdentity(spieler, spieler.inactive_since !== null)}</Table.Cell>

                    <Table.Cell className={CELL_INNER}>
                      {spieler.selected?.position ? (
                        <span className="fluid-sm text-foreground font-semibold">{spieler.selected.position}</span>
                      ) : null}
                    </Table.Cell>

                    <Table.Cell className={CELL_INNER}>
                      {spieler.selected?.stufe ? (
                        <span className="fluid-sm text-foreground font-semibold">{spieler.selected.stufe}</span>
                      ) : null}
                    </Table.Cell>

                    <Table.Cell className={CELL_EDGE}>{renderActions(spieler)}</Table.Cell>
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
