"use client";

import { memo } from "react";

import { Cpu, Globe, Person } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionCopy, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { CLIPBOARD_ERROR_DETAIL, CLIPBOARD_ERROR_TITLE, copyTextToClipboard } from "@/shared/utils/clipboard";

import { AKTION_HERKUNFT_LABELS, AKTION_OPERATION_LABELS, AKTION_OPERATION_TINTS, AKTIONEN_CRUD_COPY } from "../../constants";
import { describeAktionDatensatz, formatAktionZeitpunkt, herkunftOfAktor, labelForCollection } from "../../utils";

import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";
import type { AktionHerkunft } from "../../constants";
import type { AdminAktionRow } from "../../types";

/**
 * The two origins a row cannot name a person for, each with the symbol and tint that names it instead.
 * Exhaustive over them, so an origin added beside these fails here rather than rendering an empty cell.
 */
const AKTEUR_OHNE_ADRESSE: Record<Exclude<AktionHerkunft, "person">, { Icon: typeof Person; iconClass: string; badge: string }> = {
  system: { Icon: Cpu, iconClass: "text-foreground-muted", badge: "bg-muted text-foreground-muted" },
  // Tinted where the system's row is grey: a write the league itself made needs no second look, and a
  // request that came in from outside is the row an admin is scanning the log for.
  public: { Icon: Globe, iconClass: "text-info-strong", badge: "bg-info/15 text-info-strong" },
};

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: AKTIONEN_CRUD_COPY.emptyForQuery,
  filtered: AKTIONEN_CRUD_COPY.emptyForFilters,
  none: AKTIONEN_CRUD_COPY.emptyOverall,
};

/**
 * A react-aria collection re-rendered while hidden loses its rows, and the parent's
 * `useSearchParams()` re-renders this one on any navigation. `Table.Body`'s `items` form carries the
 * fix; `memo` is the second layer.
 */
export const AdminAktionenTable = memo(function AdminAktionenTable({
  filteredAktionen,
  emptiness,
}: {
  filteredAktionen: AdminAktionRow[];
  /** `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` carries what each value means. */
  emptiness: CrudEmptiness;
}) {
  const handleCopyVorgang = async (aktion: AdminAktionRow) => {
    const copied = await copyTextToClipboard(aktion.correlation_id);

    if (copied) appToast.success("Vorgangsnummer kopiert", { description: "Suche danach, um jede Zeile dieses Vorgangs zu sehen." });
    else appToast.danger(CLIPBOARD_ERROR_TITLE, { description: CLIPBOARD_ERROR_DETAIL });
  };

  // One source for both layouts, so the table's cells and the phone cards cannot disagree about a row.
  const renderZeitpunkt = (aktion: AdminAktionRow) => {
    const { datum, uhrzeit } = formatAktionZeitpunkt(aktion.at);

    return (
      <div className="flex flex-col gap-0.5 tabular-nums">
        <span className="fluid-sm text-foreground font-bold">{datum}</span>
        {uhrzeit !== null && <span className="muted-meta">{uhrzeit} Uhr</span>}
      </div>
    );
  };

  const renderAkteur = (aktion: AdminAktionRow) => {
    const herkunft = herkunftOfAktor(aktion.actor);

    // The one origin whose stored address is a mailbox. Every other carries a sentinel there, so it is
    // named by its origin instead -- printing `PUBLIC` would read as a person nobody can write to.
    if (herkunft === "person") {
      return (
        <div className="flex min-w-0 flex-row items-center gap-3">
          <Person
            className="text-brand shrink-0"
            width={18}
            height={18}
          />
          <span className="fluid-sm text-foreground min-w-0 truncate font-semibold">{aktion.actor.email}</span>
        </div>
      );
    }

    const { Icon, iconClass, badge } = AKTEUR_OHNE_ADRESSE[herkunft];

    return (
      <div className="flex flex-row items-center gap-3">
        <Icon
          className={`${iconClass} shrink-0`}
          width={18}
          height={18}
        />
        <span className={`${LABEL_BADGE} ${badge}`}>{AKTION_HERKUNFT_LABELS[herkunft]}</span>
      </div>
    );
  };

  const renderArtTag = (aktion: AdminAktionRow) => (
    <span className={`${LABEL_BADGE} ${AKTION_OPERATION_TINTS[aktion.operation]}`}>{AKTION_OPERATION_LABELS[aktion.operation]}</span>
  );

  // A tag of its own and never a word inside a sentence: the nine area names carry three grammatical
  // genders, so any article or pronoun agreeing with the value is wrong for most of them.
  const renderBereichTag = (aktion: AdminAktionRow) => (
    <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>{labelForCollection(aktion.collection)}</span>
  );

  const renderAufruf = (aktion: AdminAktionRow) =>
    aktion.request === null ? (
      <span className="fluid-xs text-foreground-muted/50 italic">Ohne Aufruf</span>
    ) : (
      <span className="fluid-xs text-foreground-muted flex flex-row flex-wrap gap-x-1.5 font-mono break-all">
        <span className="font-bold">{aktion.request.method}</span>
        <span>{aktion.request.path}</span>
      </span>
    );

  const renderDatensatz = (aktion: AdminAktionRow) => {
    const datensatz = describeAktionDatensatz(aktion);

    if (datensatz.kind === "dokument") return <span className="fluid-xs text-foreground font-mono break-all">{datensatz.id}</span>;
    if (datensatz.kind === "ohne") return <span className="fluid-xs text-foreground-muted/50 italic">Kein Datensatz benannt</span>;

    return (
      <div className="flex flex-col gap-0.5">
        {datensatz.filterPaare.map(([feld, wert]) => (
          <span
            key={feld}
            className="fluid-xs flex flex-row flex-wrap gap-x-1.5 font-mono break-all">
            <span className="text-foreground-muted">{feld}</span>
            <span className="text-foreground">{wert}</span>
          </span>
        ))}
        {/* A readout rather than a sentence: "12 Datensätze" would have to agree with a count of one. */}
        {datensatz.betroffen !== null && (
          <span className="muted-meta">
            Betroffen: <span className="text-foreground font-bold tabular-nums">{datensatz.betroffen}</span>
          </span>
        )}
      </div>
    );
  };

  /**
   * Nothing at all where a write replaced nothing: an insert has no earlier state, so a badge there would announce an
   * absence that is the normal case. A redaction reports in place of the copy, because the values it names are gone.
   */
  const renderStandBadge = (aktion: AdminAktionRow) => {
    if (aktion.redacted_at !== null) {
      return (
        <span className={`${LABEL_BADGE} bg-danger/15 text-danger-strong`}>
          Werte gelöscht am {formatAktionZeitpunkt(aktion.redacted_at).datum}
        </span>
      );
    }

    if (aktion.stand_gesichert) return <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Stand gesichert</span>;

    return null;
  };

  // The row has no name to be announced by, so the moment it happened is what tells two of them apart.
  const zeitpunktLabel = (aktion: AdminAktionRow) => {
    const { datum, uhrzeit } = formatAktionZeitpunkt(aktion.at);

    return uhrzeit === null ? datum : `${datum} um ${uhrzeit} Uhr`;
  };

  const renderActions = (aktion: AdminAktionRow) => (
    <RowActions>
      <RowActionCopy
        label="Vorgangsnummer kopieren"
        ariaLabel={`Vorgangsnummer der Änderung vom ${zeitpunktLabel(aktion)} kopieren`}
        onPress={() => handleCopyVorgang(aktion)}
      />
    </RowActions>
  );

  return (
    <>
      {/* One card per change, so nothing scrolls horizontally. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredAktionen.length === 0 && <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />}
        {filteredAktionen.map((aktion) => (
          <div
            key={aktion.id}
            className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
            <div className="flex w-full flex-row items-center gap-3">
              {renderZeitpunkt(aktion)}
              <span className="ml-auto shrink-0">{renderArtTag(aktion)}</span>
            </div>
            {renderAkteur(aktion)}
            <div className="flex flex-row flex-wrap items-center gap-1.5">
              {renderBereichTag(aktion)}
              {renderStandBadge(aktion)}
            </div>
            <div className="flex flex-col gap-0.5">
              {renderDatensatz(aktion)}
              {renderAufruf(aktion)}
            </div>
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(aktion)}</div>
          </div>
        ))}
      </div>

      <div className="hidden w-full md:block">
        <Table className={`${card()} h-fit w-full p-0`}>
          {/* No `scrollbar-hide`: below the minimum declared on the table this container is the
              only way to reach the columns it cannot fit, and a hidden bar says it is not. */}
          <Table.ScrollContainer>
            {/* Fixed layout holds the columns when the rows go. The minimum is the four declared
                columns plus 224 for Datensatz, under which it gets nothing. */}
            <Table.Content
              aria-label="Alle aufgezeichneten Änderungen"
              className="min-w-5xl table-fixed">
              <Table.Header>
                {/* PINNED, with the leftover going to Datensatz rather than to the first column: ids and
                    filter pairs are `break-all`, so that one column reads at any width it is given. */}
                <Table.Column
                  isRowHeader
                  className="bg-muted text-foreground-muted fluid-xs border-border w-40 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Zeitpunkt
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-72 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Wer
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-56 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Art
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Datensatz
                </Table.Column>
                {/* One control — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts` holds
                the arithmetic, and here the heading is wider than the control it sits over. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-32 border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
                  Aktionen
                </Table.Column>
              </Table.Header>

              {/* `items` plus a render function, never mapped children: the static form stops
                  committing its row collection after a few navigations away and back. */}
              <Table.Body
                items={filteredAktionen}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(aktion: AdminAktionRow) => (
                  <Table.Row
                    id={aktion.id}
                    className="border-border/50 border-b last:border-b-0">
                    <Table.Cell className="px-6 py-4">{renderZeitpunkt(aktion)}</Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderAkteur(aktion)}</Table.Cell>

                    <Table.Cell className="px-6 py-4">
                      <div className="flex flex-col items-start gap-1.5">
                        {renderArtTag(aktion)}
                        {renderAufruf(aktion)}
                      </div>
                    </Table.Cell>

                    <Table.Cell className="px-6 py-4">
                      <div className="flex flex-col items-start gap-1.5">
                        {renderBereichTag(aktion)}
                        {renderDatensatz(aktion)}
                        {renderStandBadge(aktion)}
                      </div>
                    </Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderActions(aktion)}</Table.Cell>
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
