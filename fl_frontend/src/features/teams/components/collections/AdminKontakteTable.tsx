"use client";

import { memo } from "react";
import { useSearchParams } from "next/navigation";

import { Pencil, Person } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { einwilligungHerkunftLabel, KONTAKT_ROLLEN, KONTAKTE_CRUD_COPY } from "@/features/teams/constants";
import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionCopy, RowActionLink, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { CLIPBOARD_ERROR_DETAIL, CLIPBOARD_ERROR_TITLE, copyTextToClipboard } from "@/shared/utils/clipboard";
import { formatSpielDatum } from "@/shared/utils/format";

import type { AdminKontaktRow } from "@/features/teams/types";
import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: KONTAKTE_CRUD_COPY.emptyForQuery,
  filtered: KONTAKTE_CRUD_COPY.emptyForFilters,
  none: KONTAKTE_CRUD_COPY.emptyOverall,
};

const ROLLE_LABELS: Record<AdminKontaktRow["rolle"], string> = Object.fromEntries(
  KONTAKT_ROLLEN.map(({ value, label }) => [value, label]),
) as Record<AdminKontaktRow["rolle"], string>;

/**
 * A cell with nothing behind it says so in words: what a seat holds is a fact the reader needs read
 * out, and the column it stands in is what decides which sentence fits.
 */
const emptyCell = (text: string) => <span className="fluid-sm text-foreground-muted">{text}</span>;

/**
 * A react-aria collection re-rendered while hidden in an Activity tree loses its rows, and the
 * parent's `useSearchParams()` re-renders this one on any navigation. `Table.Body`'s `items` form
 * carries the fix; `memo` is the second layer.
 */
export const AdminKontakteTable = memo(function AdminKontakteTable({
  filteredKontakte,
  emptiness,
}: {
  filteredKontakte: AdminKontaktRow[];
  /** `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` carries what each value means. */
  emptiness: CrudEmptiness;
}) {
  // The sidemenu's season rides along, so the contacts editor opens on the season being worked in
  // rather than on the current one. The seats are season-scoped, so without it the link would open
  // another season's three people.
  const searchParams = useSearchParams();
  const selectedSaisonId = searchParams.get("saison_id");
  const saisonParam = selectedSaisonId ? `?saison_id=${encodeURIComponent(selectedSaisonId)}` : "";

  // The seat naming itself is left to the badge under this line, and nothing states WHY it is empty:
  // the row keeps no such field, so any word for it would be one the record cannot support.
  const fullName = (kontakt: AdminKontaktRow) =>
    kontakt.person === null ? "Niemand hinterlegt" : `${kontakt.person.vorname} ${kontakt.person.nachname}`;

  const handleCopyKontakt = async (person: NonNullable<AdminKontaktRow["person"]>) => {
    const details = [`${person.vorname} ${person.nachname}`, person.email, person.telefon].join(" | ");
    const copied = await copyTextToClipboard(details);

    if (copied) appToast.success("Kontaktdaten kopiert");
    else appToast.danger(CLIPBOARD_ERROR_TITLE, { description: CLIPBOARD_ERROR_DETAIL });
  };

  // One source for both layouts, so the table's cells and the phone cards cannot disagree about a row.
  const renderRolle = (kontakt: AdminKontaktRow) => (
    <div className="flex flex-row flex-wrap items-center gap-2">
      <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>{ROLLE_LABELS[kontakt.rolle]}</span>
      {/* On this seat alone: beside `Trainer` the badge would name that row's own seat back at it. */}
      {kontakt.istTrainerZugleich && <span className={`${LABEL_BADGE} bg-info/15 text-info-strong`}>Zugleich Trainer</span>}
    </div>
  );

  const renderKontakt = (kontakt: AdminKontaktRow) =>
    kontakt.person === null ? (
      emptyCell("Keine Kontaktdaten")
    ) : (
      <div className="flex flex-col gap-0.5">
        <span className="fluid-sm text-foreground">{kontakt.person.email}</span>
        <span className="fluid-xs text-foreground-muted">{kontakt.person.telefon}</span>
      </div>
    );

  const renderEinwilligung = (kontakt: AdminKontaktRow) =>
    kontakt.person === null ? (
      emptyCell("Keine Einwilligung")
    ) : (
      <div className="flex flex-col gap-0.5">
        <span className="fluid-sm text-foreground">{einwilligungHerkunftLabel(kontakt.person.einwilligung.erteilt_von)}</span>
        <span className="fluid-xs text-foreground-muted">
          {`Fassung ${kontakt.person.einwilligung.text_version}, ab ${formatSpielDatum(kontakt.person.einwilligung.datum)}`}
        </span>
      </div>
    );

  const renderActions = (kontakt: AdminKontaktRow) => {
    const person = kontakt.person;

    return (
      <RowActions>
        {/* Dropped rather than disabled where the seat holds nobody: a control offering to copy an
          empty line is one press that reports success over nothing. */}
        {person !== null && (
          <RowActionCopy
            label="Kontaktdaten kopieren"
            ariaLabel={`Kontaktdaten von ${fullName(kontakt)} kopieren`}
            onPress={() => handleCopyKontakt(person)}
          />
        )}
        {/* A link and not a press: a row is one seat, and all three are edited together on the club's
            own contacts page. */}
        <RowActionLink
          href={`/admin/kontakte/${kontakt.teamId}${saisonParam}`}
          label="Kontakte bearbeiten"
          ariaLabel={`Kontakte von ${kontakt.teamName} bearbeiten`}>
          <Pencil
            aria-hidden="true"
            width={18}
            height={18}
          />
        </RowActionLink>
      </RowActions>
    );
  };

  return (
    <>
      {/* One card per person, so nothing scrolls horizontally. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredKontakte.length === 0 && <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />}
        {filteredKontakte.map((kontakt) => (
          <div
            key={kontakt.id}
            className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
            <div className="flex w-full flex-row items-center gap-3">
              <Person
                className="text-brand shrink-0"
                width={18}
                height={18}
              />
              <span
                className={`fluid-sm min-w-0 truncate font-semibold ${kontakt.person === null ? "text-foreground-muted" : "text-foreground"}`}>
                {fullName(kontakt)}
              </span>
              <span className="bg-brand-solid text-brand-solid-foreground fluid-xs ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-lg font-extrabold">
                {kontakt.teamShorthand}
              </span>
            </div>
            {renderRolle(kontakt)}
            {renderKontakt(kontakt)}
            {renderEinwilligung(kontakt)}
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(kontakt)}</div>
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
              aria-label="Tabelle aller Kontakte"
              className="min-w-6xl table-fixed">
              <Table.Header>
                <Table.Column
                  isRowHeader
                  className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Person
                </Table.Column>
                {/* PINNED to their content's width, so the leftover all goes to the name column. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-56 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Team
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-72 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Kontakt
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-60 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Einwilligung
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
                {(kontakt: AdminKontaktRow) => (
                  <Table.Row
                    id={kontakt.id}
                    className="border-border/50 border-b last:border-b-0">
                    <Table.Cell className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Person
                          className="text-brand shrink-0"
                          width={18}
                          height={18}
                        />
                        <div className="flex flex-col items-start gap-1">
                          <span className={`fluid-sm font-semibold ${kontakt.person === null ? "text-foreground-muted" : "text-foreground"}`}>
                            {fullName(kontakt)}
                          </span>
                          {renderRolle(kontakt)}
                        </div>
                      </div>
                    </Table.Cell>

                    <Table.Cell className="px-6 py-4">
                      <span className="fluid-sm text-foreground">{kontakt.teamName}</span>
                    </Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderKontakt(kontakt)}</Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderEinwilligung(kontakt)}</Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderActions(kontakt)}</Table.Cell>
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
