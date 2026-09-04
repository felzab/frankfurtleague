"use client";

import { memo } from "react";

import { ArrowRightFromSquare, GraduationCap, Persons } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { bestaetigungsStand, endstand, istOffen } from "@/features/bewerbungen/bestaetigungStand";
import { BEWERBUNG_STATUS_TINT, bewerbungStatusLabel } from "@/features/bewerbungen/constants";
import { BEWERBUNG_DUBLETTE_LABEL, BEWERBUNG_DUBLETTE_TINT } from "@/features/bewerbungen/duplicates";
import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
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
  /** Which open applications share a club or a Kürzel, by id — derived over the whole list, never over this one. */
  dubletten: ReadonlyMap<string, BewerbungDublette>;
  /** `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` carries what each value means. */
  emptiness: CrudEmptiness;
}) {
  const saisonHref = useSaisonHref();

  // One source for both layouts, so the table's cells and the phone cards cannot disagree about a
  // row or its controls.
  const renderName = (bewerbung: AdminBewerbungRow) =>
    bewerbung.teamName === null ? (
      <span className="fluid-sm text-foreground-muted/50 italic">{NO_TEAM}</span>
    ) : (
      <span className="fluid-sm text-foreground min-w-0 truncate font-semibold">{bewerbung.teamName}</span>
    );

  const renderStatus = (bewerbung: AdminBewerbungRow) => (
    <span className={`${LABEL_BADGE} ${BEWERBUNG_STATUS_TINT[bewerbung.status]}`}>{bewerbungStatusLabel(bewerbung.status)}</span>
  );

  // The Ansprechperson is who the league writes to first; the Trainer stands in where that seat is
  // empty, an erasure clearing one slot without reaching the two beside it.
  const renderKontakt = (bewerbung: AdminBewerbungRow) => {
    const person = bewerbung.kontakte.ansprechperson ?? bewerbung.kontakte.trainer;

    return (
      // Truncated rather than allowed to spill: fixed layout will not widen this column for a long
      // address, and an overflowing one draws itself across the column beside it.
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="fluid-sm text-foreground min-w-0 truncate">
          {person === null ? (
            <span className="text-foreground-muted/50 italic">Keine Kontaktperson</span>
          ) : (
            `${person.vorname} ${person.nachname}`
          )}
        </span>
        <span className="fluid-xs text-foreground-muted min-w-0 truncate">
          {person === null || person.email === "" ? <span className="text-foreground-muted/50 italic">Keine E-Mail</span> : person.email}
        </span>
      </div>
    );
  };

  // A new school and an existing club are decided differently — the first one gets created — so the
  // row says which it is before it is opened.
  const renderHerkunft = (bewerbung: AdminBewerbungRow) =>
    bewerbung.schule !== null ? (
      <span className={`${LABEL_BADGE} bg-brand/10 text-brand-solid`}>Neue Schule</span>
    ) : (
      <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Bestehendes Team</span>
    );

  // Beside the Herkunft badge in both layouts: a second application for one club is a fact about
  // where the row came from, and the administrator decides it by declining whichever is not real.
  const renderDublette = (bewerbung: AdminBewerbungRow) => {
    const art = dubletten.get(bewerbung.id);

    if (art === undefined) return null;

    return <span className={`${LABEL_BADGE} ${BEWERBUNG_DUBLETTE_TINT}`}>{BEWERBUNG_DUBLETTE_LABEL[art]}</span>;
  };

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
      return <span className={`${LABEL_BADGE} bg-danger/15 text-danger-strong`}>{endgueltig}</span>;
    }

    const bestaetigt = staende.filter((sitz) => !istOffen(sitz)).length;
    const tint = bestaetigt === staende.length ? "bg-success/15 text-success-strong" : "bg-warning/15 text-warning-strong";

    return (
      <span className={`${LABEL_BADGE} ${tint}`}>
        {String(bestaetigt)} von {String(staende.length)} bestätigt
      </span>
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
            <div className="flex w-full min-w-0 flex-row items-center gap-3">
              <GraduationCap
                className="text-brand shrink-0"
                width={18}
                height={18}
              />
              {renderName(bewerbung)}
              <span className="ml-auto shrink-0">{renderStatus(bewerbung)}</span>
            </div>
            <div className="flex flex-row flex-wrap items-center gap-2">
              {renderHerkunft(bewerbung)}
              {renderDublette(bewerbung)}
              {renderBestaetigung(bewerbung)}
              <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Saison {bewerbung.saison_id}</span>
              <span className="fluid-xs text-foreground-muted">Eingereicht {formatSpielDatum(bewerbung.eingereicht_am)}</span>
            </div>
            {renderKontakt(bewerbung)}
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(bewerbung)}</div>
          </div>
        ))}
      </div>

      <div className="hidden w-full md:block">
        <Table className={`${card()} h-fit w-full p-0`}>
          {/* No `scrollbar-hide`: below the minimum declared on the table this container is the only
              way to reach the columns it cannot fit, and a hidden bar says it is not. */}
          <Table.ScrollContainer>
            {/* Fixed layout holds the columns when the rows go. The minimum is every pinned column's
                width plus a floor for the name, under which the name gets nothing. `text-left` here
                because `Table.Column` takes no alignment prop. */}
            <Table.Content
              aria-label="Tabelle aller Bewerbungen"
              className="min-w-7xl table-fixed text-left">
              <Table.Header>
                {/* DECLARED, so the spare width above the floor goes to Ansprechperson: a club's
                    name stops at a length, where a name and an address beside each other read
                    longer the more room they get. */}
                <Table.Column
                  isRowHeader
                  className="bg-muted text-foreground-muted fluid-xs border-border w-64 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Team
                </Table.Column>
                {/* PINNED to the widest PILL each carries rather than to its heading, which may
                    wrap: `LABEL_BADGE` holds one line, so a column under its pill's width pushes
                    the pill across the one beside it. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-44 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Herkunft
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-24 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Saison
                </Table.Column>
                {/* A calendar date is fixed-format, so this width is a measurement rather than a
                    guess, and the cell never truncates: a clipped year is a different date. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-36 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Eingereicht
                </Table.Column>
                {/* UNDECLARED, the one column that grows: every pixel above the floor lands here,
                    and the pair below it truncates only once the table is at its minimum. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Ansprechperson
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-44 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Einwilligungen
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-36 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Status
                </Table.Column>
                {/* One control — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts` holds
                    the arithmetic, and it is the count a new action changes. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-32 border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
                  Aktionen
                </Table.Column>
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
                    <Table.Cell className="px-6 py-4">
                      {/* `min-w-0` on the row too: a flex item floors at its content's width by
                          default, and the `truncate` two levels down then never engages. */}
                      <div className="flex min-w-0 items-center gap-3">
                        <Persons
                          className="text-brand shrink-0"
                          width={18}
                          height={18}
                        />
                        {/* Stretched rather than `items-start`: a column item sized to its own
                            content has no width for an ellipsis to sit at, and the two names below
                            are the one thing in this table long enough to need one. */}
                        <div className="flex min-w-0 flex-col gap-1">
                          {renderName(bewerbung)}
                          {bewerbung.schule !== null && (
                            <span className="fluid-xs text-foreground-muted min-w-0 truncate">{bewerbung.schule.full_name}</span>
                          )}
                        </div>
                      </div>
                    </Table.Cell>

                    <Table.Cell className="px-6 py-4">
                      <div className="flex flex-col items-start gap-1">
                        {renderHerkunft(bewerbung)}
                        {renderDublette(bewerbung)}
                      </div>
                    </Table.Cell>

                    <Table.Cell className="px-6 py-4">
                      <span className="fluid-sm text-foreground font-semibold">{bewerbung.saison_id}</span>
                    </Table.Cell>

                    <Table.Cell className="px-6 py-4">
                      <span className="fluid-sm text-foreground">{formatSpielDatum(bewerbung.eingereicht_am)}</span>
                    </Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderKontakt(bewerbung)}</Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderBestaetigung(bewerbung)}</Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderStatus(bewerbung)}</Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderActions(bewerbung)}</Table.Cell>
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
