"use client";

import { memo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { ClockArrowRotateLeft, Cpu, Globe, Person } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import { CELL_EDGE, CELL_INNER, COLUMN_EDGE, COLUMN_INNER, IDENTITY_STACK, TABLE_HEADING } from "@/shared/components/ui/adminTable";
import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionCopy, RowActionLink, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { CLIPBOARD_ERROR_DETAIL, CLIPBOARD_ERROR_TITLE, copyTextToClipboard } from "@/shared/utils/clipboard";
import { withSaisonId } from "@/shared/utils/saisonHref";

import { AKTION_HERKUNFT_LABELS, AKTION_OPERATION_LABELS, AKTION_OPERATION_TINTS, AKTIONEN_CRUD_COPY } from "../../constants";
import { describeAktionDatensatz, formatAktionZeitpunkt, herkunftOfAktor, labelForCollection } from "../../utils";

import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";
import type { PillTone } from "@/shared/components/ui/badges";
import type { AktionHerkunft } from "../../constants";
import type { AdminAktionRow } from "../../types";

/**
 * The two origins a row cannot name a person for, each with the symbol and tone that names it instead.
 * Exhaustive over them, so an origin added beside these fails here rather than rendering an empty cell.
 */
const AKTEUR_OHNE_ADRESSE: Record<Exclude<AktionHerkunft, "person">, { Icon: typeof Person; iconClass: string; badge: PillTone }> = {
  // One tone for both: each answers who acted rather than grading what the write did, and the glyph
  // beside the chip takes its ink.
  system: { Icon: Cpu, iconClass: "text-info-strong", badge: "info" },
  public: { Icon: Globe, iconClass: "text-info-strong", badge: "info" },
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
  // The shell's season rides along on the history link, so narrowing the log keeps the selector's
  // season -- `AdminTeamsTable.tsx`'s row links carry it the same way.
  const searchParams = useSearchParams();
  const selectedFromUrl = searchParams.get("saison_id");
  const router = useRouter();

  /** Both halves of one press: the number for a support request, and the narrowing for its rows. */
  const handleCopyVorgang = async (aktion: AdminAktionRow) => {
    const copied = await copyTextToClipboard(aktion.trace_id);

    if (copied) appToast.success("Vorgangsnummer kopiert", { description: "Die Liste zeigt jetzt nur noch diesen Vorgang." });
    else appToast.danger(CLIPBOARD_ERROR_TITLE, { description: CLIPBOARD_ERROR_DETAIL });

    // Navigated rather than searched: the endpoint narrows on `trace_id` itself, where the search
    // reaches only the rows the cap left. Still one capped read, so neither sentence here claims the
    // Vorgang whole; the page's incompleteness callout reports the cut.
    router.push(withSaisonId(`/admin/aktionen?trace_id=${encodeURIComponent(aktion.trace_id)}`, selectedFromUrl));
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
        <span className={labelBadge(badge)}>{AKTION_HERKUNFT_LABELS[herkunft]}</span>
      </div>
    );
  };

  /**
   * The when leads and the who follows it, an audit row being who did what when and the when its sort
   * key. One source for both layouts, so the table's cells and the phone cards cannot disagree.
   */
  const renderZeitpunkt = (aktion: AdminAktionRow) => {
    const { datum, uhrzeit } = formatAktionZeitpunkt(aktion.at);

    return (
      <div className={IDENTITY_STACK}>
        <div className="font-numeric flex flex-row flex-wrap items-baseline gap-x-2 tabular-nums">
          <span className="fluid-sm text-foreground font-bold">{datum}</span>
          {uhrzeit !== null && <span className="muted-meta">{uhrzeit} Uhr</span>}
        </div>
        {renderAkteur(aktion)}
      </div>
    );
  };

  const renderArtTag = (aktion: AdminAktionRow) => (
    <span className={labelBadge(AKTION_OPERATION_TINTS[aktion.operation])}>{AKTION_OPERATION_LABELS[aktion.operation]}</span>
  );

  // A tag of its own and never a word inside a sentence: the nine area names carry three grammatical
  // genders, so any article or pronoun agreeing with the value is wrong for most of them.
  const renderBereichTag = (aktion: AdminAktionRow) => <span className={labelBadge("info")}>{labelForCollection(aktion.collection)}</span>;

  const renderAufruf = (aktion: AdminAktionRow) =>
    aktion.request === null ? (
      <span className="fluid-xs text-foreground-muted italic">Ohne Aufruf</span>
    ) : (
      <span className="fluid-xs text-foreground-muted flex flex-row flex-wrap gap-x-1 font-mono break-all">
        <span className="font-bold">{aktion.request.method}</span>
        <span>{aktion.request.path}</span>
      </span>
    );

  const renderDatensatz = (aktion: AdminAktionRow) => {
    const datensatz = describeAktionDatensatz(aktion);

    if (datensatz.kind === "dokument") return <span className="fluid-xs text-foreground font-mono break-all">{datensatz.id}</span>;
    if (datensatz.kind === "ohne") return <span className="fluid-xs text-foreground-muted italic">Kein Datensatz benannt</span>;

    return (
      <div className="flex flex-col gap-0.5">
        {datensatz.filterPaare.map(([feld, wert]) => (
          <span
            key={feld}
            className="fluid-xs flex flex-row flex-wrap gap-x-1 font-mono break-all">
            <span className="text-foreground-muted">{feld}</span>
            <span className="text-foreground">{wert}</span>
          </span>
        ))}
        {/* A readout rather than a sentence: "12 Datensätze" would have to agree with a count of one. */}
        {datensatz.betroffen !== null && (
          <span className="muted-meta">
            Betroffen: <span className="text-foreground font-numeric font-bold tabular-nums">{datensatz.betroffen}</span>
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
      return <span className={labelBadge("danger")}>Werte gelöscht am {formatAktionZeitpunkt(aktion.redacted_at).datum}</span>;
    }

    if (aktion.stand_gesichert) return <span className={labelBadge("success")}>Stand gesichert</span>;

    return null;
  };

  /**
   * The operation and the area are one fact about the write, and the request that made it belongs
   * with the record it was made against: that is why one column holds all four.
   */
  const renderAenderung = (aktion: AdminAktionRow) => (
    <div className="flex min-w-0 flex-col items-start gap-2">
      <div className="flex flex-row flex-wrap gap-2">
        {renderArtTag(aktion)}
        {renderBereichTag(aktion)}
      </div>
      {renderDatensatz(aktion)}
      {renderStandBadge(aktion)}
      {renderAufruf(aktion)}
    </div>
  );

  // The row has no name to be announced by, so the moment it happened is what tells two of them apart.
  const zeitpunktLabel = (aktion: AdminAktionRow) => {
    const { datum, uhrzeit } = formatAktionZeitpunkt(aktion.at);

    return uhrzeit === null ? datum : `${datum} um ${uhrzeit} Uhr`;
  };

  const renderActions = (aktion: AdminAktionRow) => (
    <RowActions>
      {/* Only where the row names ONE document: a fan-out matched a set and a bulk create named
          nothing, so neither has a single history to open. */}
      {aktion.document_id !== null && (
        <RowActionLink
          href={withSaisonId(`/admin/aktionen?document_id=${encodeURIComponent(aktion.document_id)}`, selectedFromUrl)}
          label="Änderungen an diesem Datensatz"
          ariaLabel={`Alle Änderungen an Datensatz ${aktion.document_id} anzeigen`}>
          <ClockArrowRotateLeft
            aria-hidden="true"
            width={18}
            height={18}
          />
        </RowActionLink>
      )}
      <RowActionCopy
        label="Vorgangsnummer kopieren und den Vorgang anzeigen"
        ariaLabel={`Vorgangsnummer der Änderung vom ${zeitpunktLabel(aktion)} kopieren und den Vorgang anzeigen`}
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
            {renderZeitpunkt(aktion)}
            {renderAenderung(aktion)}
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(aktion)}</div>
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
            {/* Fixed layout holds the columns when the rows go, and the minimum is the action column
                plus an allowance for each of the two undeclared ones. */}
            <Table.Content
              aria-label="Alle aufgezeichneten Änderungen"
              className="min-w-156 table-fixed">
              <Table.Header>
                {/* BOTH UNDECLARED, which splits the remainder equally between them: the only list
                    here whose row is two blocks of like weight, where every other has one. */}
                <Table.Column
                  isRowHeader
                  className={`${TABLE_HEADING} ${COLUMN_EDGE}`}>
                  Zeitpunkt
                </Table.Column>
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_INNER}`}>Änderung</Table.Column>
                {/* Two controls — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts` holds
                the arithmetic, and below three the heading is wider than the controls it sits over. */}
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_EDGE} w-36 text-right`}>Aktionen</Table.Column>
              </Table.Header>

              {/* `items` plus a render function, never mapped children — see the memo note above. */}
              <Table.Body
                items={filteredAktionen}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(aktion: AdminAktionRow) => (
                  <Table.Row
                    id={aktion.id}
                    className="border-border/50 border-b last:border-b-0">
                    <Table.Cell className={CELL_EDGE}>{renderZeitpunkt(aktion)}</Table.Cell>

                    <Table.Cell className={CELL_INNER}>{renderAenderung(aktion)}</Table.Cell>

                    <Table.Cell className={CELL_EDGE}>{renderActions(aktion)}</Table.Cell>
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
