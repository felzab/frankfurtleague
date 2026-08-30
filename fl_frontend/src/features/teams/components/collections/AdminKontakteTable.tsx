"use client";

import { memo } from "react";
import { useSearchParams } from "next/navigation";

import { Pencil, Persons } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { KONTAKTE_CRUD_COPY } from "@/features/teams/constants";
import { KONTAKTE_BESETZUNG_OPTIONS, kontakteBesetzung } from "@/features/teams/facets";
import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionCopy, RowActionLink, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { CLIPBOARD_ERROR_DETAIL, CLIPBOARD_ERROR_TITLE, copyTextToClipboard } from "@/shared/utils/clipboard";

import type { AdminKontakteRow, AdminKontaktSeat } from "@/features/teams/types";
import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: KONTAKTE_CRUD_COPY.emptyForQuery,
  filtered: KONTAKTE_CRUD_COPY.emptyForFilters,
  none: KONTAKTE_CRUD_COPY.emptyOverall,
};

type Besetzung = ReturnType<typeof kontakteBesetzung>;

const BESETZUNG_LABELS = Object.fromEntries(KONTAKTE_BESETZUNG_OPTIONS.map(({ value, label }) => [value, label])) as Record<Besetzung, string>;

/** The badge grades the row's completeness, which is the one thing a reader scans this list for. */
const BESETZUNG_TINT: Record<Besetzung, string> = {
  vollstaendig: "bg-success/15 text-success-strong",
  teilweise: "bg-warning/15 text-warning-strong",
  leer: "bg-muted text-foreground-muted",
};

/** What a seat holding nobody says, in the register the rest of the admin uses for an absent value. */
const KEIN_EINTRAG = "Niemand hinterlegt";

/**
 * A react-aria collection re-rendered while hidden in an Activity tree loses its rows, and the
 * parent's `useSearchParams()` re-renders this one on any navigation. `Table.Body`'s `items` form
 * carries the fix; `memo` is the second layer.
 */
export const AdminKontakteTable = memo(function AdminKontakteTable({
  filteredKontakte,
  emptiness,
}: {
  filteredKontakte: AdminKontakteRow[];
  /** `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` carries what each value means. */
  emptiness: CrudEmptiness;
}) {
  // The sidemenu's season rides along, so the contacts editor opens on the season being worked in
  // rather than on the current one. The seats are season-scoped, so without it the link would open
  // another season's three people.
  const searchParams = useSearchParams();
  const selectedSaisonId = searchParams.get("saison_id");
  const saisonParam = selectedSaisonId ? `?saison_id=${encodeURIComponent(selectedSaisonId)}` : "";

  const handleCopyKontakte = async (row: AdminKontakteRow) => {
    const zeilen = row.seats.flatMap((seat) =>
      seat.person === null
        ? []
        : [`${seat.label}: ${seat.person.vorname} ${seat.person.nachname} | ${seat.person.email} | ${seat.person.telefon}`],
    );
    const copied = await copyTextToClipboard([row.teamName, ...zeilen].join("\n"));

    if (copied) appToast.success("Kontaktdaten kopiert");
    else appToast.danger(CLIPBOARD_ERROR_TITLE, { description: CLIPBOARD_ERROR_DETAIL });
  };

  /** One seat as both layouts render it, so a cell and a phone card cannot disagree about a person. */
  const renderSeat = (seat: AdminKontaktSeat) => (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-row flex-wrap items-center gap-2">
        <span className="fluid-xxs text-foreground-muted font-extrabold tracking-widest uppercase">{seat.label}</span>
        {/* On the seat the claim POINTS AT: beside `Trainer` the badge would name that seat back at it. */}
        {seat.istTrainerZugleich && <span className={`${LABEL_BADGE} bg-info/15 text-info-strong`}>Zugleich Trainer</span>}
      </div>

      {seat.person === null ? (
        <span className="fluid-sm text-foreground-muted">{KEIN_EINTRAG}</span>
      ) : (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="fluid-sm text-foreground truncate font-semibold">{`${seat.person.vorname} ${seat.person.nachname}`}</span>
          <span className="fluid-xs text-foreground-muted truncate">{seat.person.email}</span>
          <span className="fluid-xs text-foreground-muted truncate">{seat.person.telefon}</span>
        </div>
      )}
    </div>
  );

  const renderBesetzung = (row: AdminKontakteRow) => {
    const stand = kontakteBesetzung(row.besetzt);

    return <span className={`${LABEL_BADGE} ${BESETZUNG_TINT[stand]}`}>{BESETZUNG_LABELS[stand]}</span>;
  };

  const renderActions = (row: AdminKontakteRow) => (
    <RowActions>
      {/* Dropped rather than disabled where the club has nobody on file: a control offering to copy
          an empty block is one press that reports success over nothing. */}
      {row.besetzt > 0 && (
        <RowActionCopy
          label="Kontaktdaten kopieren"
          ariaLabel={`Kontaktdaten von ${row.teamName} kopieren`}
          onPress={() => void handleCopyKontakte(row)}
        />
      )}
      {/* A link and not a press: all three seats are edited together on the club's own contacts page,
          which is what this row stands for. */}
      <RowActionLink
        href={`/admin/kontakte/${row.teamId}${saisonParam}`}
        label="Kontakte bearbeiten"
        ariaLabel={`Kontakte von ${row.teamName} bearbeiten`}>
        <Pencil
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
    </RowActions>
  );

  return (
    <>
      {/* One card per club, so nothing scrolls horizontally. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredKontakte.length === 0 && <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />}
        {filteredKontakte.map((row) => (
          <div
            key={row.id}
            className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
            <div className="flex w-full flex-row items-center gap-3">
              <Persons
                className="text-brand shrink-0"
                width={18}
                height={18}
              />
              <span className="fluid-sm text-foreground min-w-0 truncate font-semibold">{row.teamName}</span>
              <span className="bg-brand-solid text-brand-solid-foreground fluid-xs ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-extrabold">
                {row.teamShorthand}
              </span>
            </div>

            {renderBesetzung(row)}

            <div className="border-border/50 flex flex-col gap-3 border-t pt-3">
              {row.seats.map((seat) => (
                <div key={seat.rolle}>{renderSeat(seat)}</div>
              ))}
            </div>

            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(row)}</div>
          </div>
        ))}
      </div>

      <div className="hidden w-full md:block">
        <Table className={`${card()} h-fit w-full p-0`}>
          {/* No `scrollbar-hide`: below the minimum declared on the table this container is the only
              way to reach the columns it cannot fit, and a hidden bar says it is not. */}
          <Table.ScrollContainer>
            {/* Fixed layout holds the columns when the rows go. */}
            <Table.Content
              aria-label="Tabelle aller Kontakte je Team"
              className="min-w-6xl table-fixed">
              <Table.Header>
                <Table.Column
                  isRowHeader
                  className="bg-muted text-foreground-muted fluid-xs border-border w-60 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Team
                </Table.Column>
                {/* One column per seat, in the order the editor asks for them: the three ARE the
                    record, so a reader compares them across clubs by scanning one column. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Trainer
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Ansprechperson
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Stellvertretung
                </Table.Column>
                {/* Two controls — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts` holds
                    the arithmetic, and it is the count a new action changes. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-36 border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
                  Aktionen
                </Table.Column>
              </Table.Header>

              {/* `items` plus a render function, never mapped children: the static form stops
                  committing its row collection after a few navigations away and back. */}
              <Table.Body
                items={filteredKontakte}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(row: AdminKontakteRow) => (
                  <Table.Row
                    id={row.id}
                    className="border-border/50 border-b last:border-b-0">
                    <Table.Cell className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Persons
                          className="text-brand shrink-0"
                          width={18}
                          height={18}
                        />
                        <div className="flex min-w-0 flex-col items-start gap-1">
                          <span className="fluid-sm text-foreground truncate font-semibold">{row.teamName}</span>
                          {renderBesetzung(row)}
                        </div>
                      </div>
                    </Table.Cell>

                    {row.seats.map((seat) => (
                      <Table.Cell
                        key={seat.rolle}
                        className="px-6 py-4">
                        {renderSeat(seat)}
                      </Table.Cell>
                    ))}

                    <Table.Cell className="px-6 py-4">{renderActions(row)}</Table.Cell>
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
