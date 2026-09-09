"use client";

import { memo } from "react";
import { useSearchParams } from "next/navigation";

import { Pencil } from "@gravity-ui/icons";

import { SHORTHAND_CHIP } from "@/features/spieler/shorthandChip";
import { KONTAKTE_CRUD_COPY } from "@/features/teams/constants";
import { KONTAKTE_BESETZUNG_OPTIONS, kontakteBesetzung } from "@/features/teams/facets";
import { AdminCrudEmptyCard } from "@/shared/components/ui/AdminCrudEmpty";
import { IDENTITY_HEAD, IDENTITY_NAME, IDENTITY_ROW, IDENTITY_STACK } from "@/shared/components/ui/adminTable";
import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionCopy, RowActionLink, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { CLIPBOARD_ERROR_DETAIL, CLIPBOARD_ERROR_TITLE, copyTextToClipboard } from "@/shared/utils/clipboard";
import { withSaisonId } from "@/shared/utils/saisonHref";

import type { AdminKontakteRow, AdminKontaktSeat } from "@/features/teams/types";
import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";
import type { PillTone } from "@/shared/components/ui/badges";

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: KONTAKTE_CRUD_COPY.emptyForQuery,
  filtered: KONTAKTE_CRUD_COPY.emptyForFilters,
  none: KONTAKTE_CRUD_COPY.emptyOverall,
};

type Besetzung = ReturnType<typeof kontakteBesetzung>;

const BESETZUNG_LABELS = Object.fromEntries(KONTAKTE_BESETZUNG_OPTIONS.map(({ value, label }) => [value, label])) as Record<Besetzung, string>;

/**
 * The badge grades the row's completeness, which is the one thing a reader scans this list for.
 * `leer` is the bottom of that grade rather than a missing value: nobody can reach the club at all.
 */
const BESETZUNG_TINT: Record<Besetzung, PillTone> = {
  vollstaendig: "success",
  teilweise: "warning",
  leer: "danger",
};

/** What a seat holding nobody says, in the register the rest of the admin uses for an absent value. */
const KEIN_EINTRAG = "Niemand hinterlegt";

/**
 * **A card per club at every width, never a table.** Three seats of free text need more than the
 * narrowest content column gives a whole row, so a table scrolls sideways wherever it renders.
 * Memoised per `AdminCrudView`'s collection-identity note.
 */
export const AdminKontakteList = memo(function AdminKontakteList({
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

  /** The eyebrow names the seat at the seat, so no header row can disagree with the block under it. */
  const renderSeat = (seat: AdminKontaktSeat) => (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex flex-row flex-wrap items-center gap-2">
        <span className="fluid-xxs text-foreground-muted font-extrabold tracking-widest uppercase">{seat.label}</span>
        {/* On the seat the claim POINTS AT: beside `Trainer` the badge would name that seat back at it. */}
        {seat.istTrainerZugleich && <span className={labelBadge("info")}>Zugleich Trainer</span>}
      </div>

      {seat.person === null ? (
        <span className="fluid-sm text-foreground-muted">{KEIN_EINTRAG}</span>
      ) : (
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="fluid-sm text-foreground truncate font-semibold">{`${seat.person.vorname} ${seat.person.nachname}`}</span>
          <span className="fluid-xs text-foreground-muted truncate">{seat.person.email}</span>
          <span className="font-numeric fluid-xs text-foreground-muted truncate tabular-nums">{seat.person.telefon}</span>
        </div>
      )}
    </div>
  );

  const renderBesetzung = (row: AdminKontakteRow) => {
    const stand = kontakteBesetzung(row.besetzt);

    return <span className={labelBadge(BESETZUNG_TINT[stand])}>{BESETZUNG_LABELS[stand]}</span>;
  };

  const renderIdentity = (row: AdminKontakteRow) => (
    <div className={IDENTITY_ROW}>
      <span className={SHORTHAND_CHIP}>{row.teamShorthand}</span>
      <div className={IDENTITY_STACK}>
        <div className={IDENTITY_HEAD}>
          <span className={IDENTITY_NAME}>{row.teamName}</span>
          {renderBesetzung(row)}
        </div>
      </div>
    </div>
  );

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
        href={withSaisonId(`/admin/kontakte/${row.teamId}`, selectedSaisonId)}
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

  if (filteredKontakte.length === 0) return <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />;

  return (
    /* Named here because no heading stands over it, where every section of
       `fl_frontend/src/features/spieltage/components/collections/AdminSpieltageList.tsx` carries an
       `h2`. „Liste“ and not the „Tabelle“ its six sibling collections say: these are cards. */
    <ul
      aria-label="Liste aller Kontakte je Team"
      className="flex w-full flex-col gap-3">
      {filteredKontakte.map((row) => (
        <li
          key={row.id}
          className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
          <div className="flex w-full flex-row items-center gap-3">
            <div className="min-w-0 flex-1">{renderIdentity(row)}</div>
            {/* One of the two placements is hidden at any width, so the pair is one tab stop. */}
            <div className="hidden shrink-0 md:block">{renderActions(row)}</div>
          </div>

          {/* Three equal columns from `md`, so one seat sits under itself down the page and a reader
              still scans a single role the way a column let them. */}
          <div className="border-border/50 grid grid-cols-1 gap-3 border-t pt-3 md:grid-cols-3 md:gap-x-4">
            {row.seats.map((seat) => (
              <div key={seat.rolle}>{renderSeat(seat)}</div>
            ))}
          </div>

          <div className="border-border/50 -mx-1 border-t pt-2 md:hidden">{renderActions(row)}</div>
        </li>
      ))}
    </ul>
  );
});
