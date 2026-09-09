"use client";

import { memo } from "react";

import { ArrowRightFromSquare, GraduationCap } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { bestaetigungsStand, endstand, istOffen } from "@/features/bewerbungen/bestaetigungStand";
import { BEWERBUNG_STATUS_TINT, bewerbungStatusLabel } from "@/features/bewerbungen/constants";
import { BEWERBUNG_DUBLETTE_LABEL, BEWERBUNG_DUBLETTE_TINT } from "@/features/bewerbungen/duplicates";
import { hatUnerreichbarenSitz, ZUSTELLUNG_QUEUE_LABEL, ZUSTELLUNG_QUEUE_TINT } from "@/features/bewerbungen/zustellung";
import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import {
  CELL_EDGE,
  CELL_INNER,
  COLUMN_EDGE,
  COLUMN_INNER,
  IDENTITY_HEAD,
  IDENTITY_LINE,
  IDENTITY_NAME,
  IDENTITY_NAME_BOX,
  IDENTITY_PAIR,
  IDENTITY_ROW,
  IDENTITY_STACK,
  TABLE_HEADING,
} from "@/shared/components/ui/adminTable";
import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionLink, RowActions } from "@/shared/components/ui/RowActions";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { formatSpielDatum } from "@/shared/utils/format";

import type { BewerbungDublette } from "@/features/bewerbungen/duplicates";
import type { AdminBewerbungRow } from "@/features/bewerbungen/types";
import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: "Keine Bewerbungen für diese Suche.",
  filtered: "Keine Bewerbungen für diese Filter.",
  none: "Es sind noch keine Bewerbungen eingegangen.",
};

/** What an application naming no team at all reads as — the one `REQ-BEWERBUNG-002` refuses to accept. */
const NO_TEAM = "Kein Team benannt";

/**
 * A react-aria collection re-rendered while hidden in an Activity tree loses its rows, and the
 * parent's URL state re-renders this one on any navigation. `Table.Body`'s `items` form carries the
 * fix; `memo` is the second layer.
 */
export const AdminBewerbungenTable = memo(function AdminBewerbungenTable({
  filteredBewerbungen,
  dubletten,
  emptiness,
}: {
  filteredBewerbungen: AdminBewerbungRow[];
  /** Which open applications share a club or a Kürzel, by id — answered over the whole queue, never over this list. */
  dubletten: ReadonlyMap<string, BewerbungDublette>;
  /** `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` carries what each value means. */
  emptiness: CrudEmptiness;
}) {
  const saisonHref = useSaisonHref();

  // One source for both layouts, so the table's cells and the phone cards cannot disagree about a
  // row or its controls.
  const renderName = (bewerbung: AdminBewerbungRow) =>
    bewerbung.teamName === null ? (
      <span className={`${IDENTITY_NAME_BOX} text-foreground-muted italic`}>{NO_TEAM}</span>
    ) : (
      <span className={IDENTITY_NAME}>{bewerbung.teamName}</span>
    );

  const renderStatus = (bewerbung: AdminBewerbungRow) => (
    <span className={labelBadge(BEWERBUNG_STATUS_TINT[bewerbung.status])}>{bewerbungStatusLabel(bewerbung.status)}</span>
  );

  // A new school and an existing club are decided differently — the first one gets created — so the
  // row says which it is before it is opened.

  // One tone for both: a Herkunft is a kind and not a standing, so the word tells the two apart.
  const renderHerkunft = (bewerbung: AdminBewerbungRow) =>
    bewerbung.schule !== null ? (
      <span className={labelBadge("info")}>Neue Schule</span>
    ) : (
      <span className={labelBadge("info")}>Bestehendes Team</span>
    );

  // Beside the Herkunft badge in both layouts: a second application for one club is a fact about
  // where the row came from, and the administrator decides it by declining whichever is not real.
  const renderDublette = (bewerbung: AdminBewerbungRow) => {
    const art = dubletten.get(bewerbung.id);

    if (art === undefined) return null;

    return <span className={labelBadge(BEWERBUNG_DUBLETTE_TINT)}>{BEWERBUNG_DUBLETTE_LABEL[art]}</span>;
  };

  // Beside the duplicate mark, and `danger` where that one is `warning`: a colliding pair is waited
  // out by declining one of them, and an address the provider refuses for good is not.
  const renderUnerreichbar = (bewerbung: AdminBewerbungRow) =>
    hatUnerreichbarenSitz(bewerbung) ? <span className={labelBadge(ZUSTELLUNG_QUEUE_TINT)}>{ZUSTELLUNG_QUEUE_LABEL}</span> : null;

  // The count and never a fourth `status` value: an application waits on its contacts inside
  // `eingereicht`, and a filter over this would partition the queue on something no decision moves.
  const renderBestaetigung = (bewerbung: AdminBewerbungRow) => {
    const staende = bestaetigungsStand(bewerbung);

    // An application submitted before the workflow has no per-seat state, and a badge reading „0 von
    // 3“ over one would send an administrator hunting for links that were never sent.
    if (staende === null) return null;

    // Ahead of the count, which would read „2 von 3“ over a row no answer can complete and send an
    // administrator waiting for a third that is never coming.
    const endgueltig = endstand(staende);

    if (endgueltig !== null) {
      return <span className={labelBadge("danger")}>{endgueltig}</span>;
    }

    const bestaetigt = staende.filter((sitz) => !istOffen(sitz)).length;

    return (
      <span className={labelBadge(bestaetigt === staende.length ? "success" : "warning")}>
        {String(bestaetigt)} von {String(staende.length)} bestätigt
      </span>
    );
  };

  const renderEingereicht = (bewerbung: AdminBewerbungRow) => (
    // `font-numeric tabular-nums` is what makes a fixed-format date a fixed WIDTH under a proportional
    // page face, and the Eingereicht column's `w-32` is measured against it. Never truncate: a clipped
    // year is a different date.
    <span className="font-numeric fluid-sm text-foreground tabular-nums">{formatSpielDatum(bewerbung.eingereicht_am)}</span>
  );

  /**
   * The status pill leads because a row's standing reads before its kind, and a row cannot know
   * which facet is on. The contact is a third line: what a reader writes to once they have found
   * the application.
   */
  const renderIdentity = (bewerbung: AdminBewerbungRow) => {
    // The Ansprechperson is who the league writes to first; the Trainer stands in where that seat is
    // empty, an erasure clearing one slot without reaching the two beside it.
    const person = bewerbung.kontakte.ansprechperson ?? bewerbung.kontakte.trainer;

    return (
      <div className={IDENTITY_ROW}>
        <GraduationCap
          aria-hidden="true"
          className="text-brand shrink-0"
          width={18}
          height={18}
        />
        <div className={IDENTITY_STACK}>
          <div className={IDENTITY_HEAD}>
            {renderName(bewerbung)}
            {renderStatus(bewerbung)}
            {renderHerkunft(bewerbung)}
            {renderDublette(bewerbung)}
            {renderUnerreichbar(bewerbung)}
            {/* Words rather than a pill: the season is the ordinary case, which the date beside it
                already states in the same register. */}
            <span className="fluid-xs text-foreground-muted">
              Saison <span className="font-numeric tabular-nums">{bewerbung.saison_id}</span>
            </span>
          </div>
          {bewerbung.schule !== null && <span className={IDENTITY_LINE}>{bewerbung.schule.full_name}</span>}
          <span className={IDENTITY_PAIR}>
            <span className={IDENTITY_LINE}>
              {person === null ? <span className="italic">Keine Kontaktperson</span> : `${person.vorname} ${person.nachname}`}
            </span>
            <span className={IDENTITY_LINE}>
              {person === null || person.email === "" ? <span className="italic">Keine E-Mail</span> : person.email}
            </span>
          </span>
        </div>
      </div>
    );
  };

  const renderActions = (bewerbung: AdminBewerbungRow) => (
    <RowActions>
      {/* A link and not a press: the decision is taken on a page of its own, where the whole
          application stands. */}
      <RowActionLink
        href={saisonHref(`/admin/bewerbungen/${bewerbung.id}`)}
        label="Bewerbung öffnen"
        ariaLabel={`Bewerbung von ${bewerbung.teamName ?? NO_TEAM} öffnen`}>
        <ArrowRightFromSquare
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
    </RowActions>
  );

  return (
    <>
      {/* One card per application, so nothing scrolls horizontally. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredBewerbungen.length === 0 && <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />}
        {filteredBewerbungen.map((bewerbung) => (
          <div
            key={bewerbung.id}
            className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
            {renderIdentity(bewerbung)}
            <div className="flex flex-row flex-wrap items-center gap-2">
              <span className="fluid-xs text-foreground-muted">Eingereicht {formatSpielDatum(bewerbung.eingereicht_am)}</span>
              {renderBestaetigung(bewerbung)}
            </div>
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(bewerbung)}</div>
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
                columns plus the Team allowance come to. `text-left` here because `Table.Column` takes
                no alignment prop. */}
            <Table.Content
              aria-label="Tabelle aller Bewerbungen"
              className="min-w-156 table-fixed text-left">
              <Table.Header>
                {/* UNDECLARED: fixed layout gives it everything the columns beside it leave, and it
                    is the only one here holding free text. */}
                <Table.Column
                  isRowHeader
                  className={`${TABLE_HEADING} ${COLUMN_EDGE}`}>
                  Team
                </Table.Column>
                {/* The queue is served in this order, so a date column is what a reader checks that
                    order against; `w-32` is its heading's width, wider than the date under it. */}
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_INNER} w-32`}>Eingereicht</Table.Column>
                {/* The state the queue is worked down by, so it keeps a column of its own; the
                    heading fixes the width here rather than the pill under it. */}
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_INNER} w-40`}>Bestätigungen</Table.Column>
                {/* One control — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts` holds
                    the arithmetic, and it is the count a new action changes. */}
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_EDGE} w-32 text-right`}>Aktionen</Table.Column>
              </Table.Header>

              {/* `items` plus a render function, never mapped children: the static form stops
                  committing its row collection after a few navigations away and back. */}
              <Table.Body
                items={filteredBewerbungen}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(bewerbung: AdminBewerbungRow) => (
                  <Table.Row
                    id={bewerbung.id}
                    className="border-border/50 border-b last:border-b-0">
                    <Table.Cell className={CELL_EDGE}>{renderIdentity(bewerbung)}</Table.Cell>

                    <Table.Cell className={CELL_INNER}>{renderEingereicht(bewerbung)}</Table.Cell>

                    <Table.Cell className={CELL_INNER}>{renderBestaetigung(bewerbung)}</Table.Cell>

                    <Table.Cell className={CELL_EDGE}>{renderActions(bewerbung)}</Table.Cell>
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
