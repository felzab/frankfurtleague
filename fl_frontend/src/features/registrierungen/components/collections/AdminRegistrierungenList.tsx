"use client";

import { memo } from "react";

import Hourglass from "@gravity-ui/icons/Hourglass";
import Pencil from "@gravity-ui/icons/Pencil";

import { BESTAETIGT_MARKE, REGISTRIERUNGEN_CRUD_COPY } from "@/features/registrierungen/constants";
import { AdminCrudEmptyCard } from "@/shared/components/ui/AdminCrudEmpty";
import {
  IDENTITY_HEAD_CLASSES,
  IDENTITY_LINE_CLASSES,
  IDENTITY_NAME_CLASSES,
  IDENTITY_ROW_CLASSES,
  IDENTITY_STACK_CLASSES,
} from "@/shared/components/ui/adminTable";
import { Leer } from "@/shared/components/ui/Angabe";
import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionLink, RowActions } from "@/shared/components/ui/RowActions";
import { formatSpielDatum, nichtHinterlegt } from "@/shared/utils/format";
import { withSaisonId } from "@/shared/utils/saisonHref";

import type { AdminRegistrierungRow } from "@/features/registrierungen/types";
import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";
import type { ReactNode } from "react";

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: REGISTRIERUNGEN_CRUD_COPY.emptyForQuery,
  // The search sentence: nothing but the bar narrows this list, so `filtered` is German no reader reaches.
  filtered: REGISTRIERUNGEN_CRUD_COPY.emptyForQuery,
  none: REGISTRIERUNGEN_CRUD_COPY.emptyOverall,
};

/** The eyebrow over each fact, one cell of the card's grid. */
const FACT_LABEL_CLASSES = "fluid-xxs font-extrabold tracking-widest text-foreground-muted uppercase";

/** Where no label stands beside the words, so they name the field. */
const NO_TEAM = nichtHinterlegt("Team");

/**
 * **A card per registration at every width, never a table**. Memoised per
 * `AdminCrudView`'s collection-identity note.
 */
export const AdminRegistrierungenList = memo(function AdminRegistrierungenList({
  filteredRegistrierungen,
  emptiness,
}: {
  filteredRegistrierungen: AdminRegistrierungRow[];
  /** `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` carries what each value means. */
  emptiness: CrudEmptiness;
}) {
  /** The eyebrow names the fact at the fact, so no heading over the list can disagree with the block under it. */
  const renderFact = (label: string, wert: ReactNode) => (
    <div className="flex min-w-0 flex-col gap-1">
      <span className={FACT_LABEL_CLASSES}>{label}</span>
      {wert}
    </div>
  );

  const renderIdentity = (registrierung: AdminRegistrierungRow) => (
    <div className={IDENTITY_ROW_CLASSES}>
      <Hourglass
        aria-hidden="true"
        className="size-4.5 shrink-0 text-foreground-muted"
      />
      <div className={IDENTITY_STACK_CLASSES}>
        <div className={IDENTITY_HEAD_CLASSES}>
          <span className={IDENTITY_NAME_CLASSES}>{`${registrierung.vorname} ${registrierung.nachname}`}</span>
          <span className={labelBadge(registrierung.bestaetigt ? "success" : "warning")}>
            {registrierung.bestaetigt ? BESTAETIGT_MARKE.ja : BESTAETIGT_MARKE.nein}
          </span>
        </div>
        {/* The team's own card's line, word for word: the day the queue is read by. */}
        <span className={IDENTITY_LINE_CLASSES}>Registriert am {formatSpielDatum(registrierung.eingereicht_am)}</span>
      </div>
    </div>
  );

  const renderActions = (registrierung: AdminRegistrierungRow) => (
    <RowActions>
      {/* The row's OWN season, never the header's: the list spans every season, and the seats it is
          cured on are that season's. The subject names the pupil, one team holding several rows. */}
      <RowActionLink
        href={withSaisonId(`/bereich/admin/kontakte/${registrierung.team_id}`, registrierung.saison_id)}
        label="Kontakte bearbeiten"
        subject={`${registrierung.teamName ?? NO_TEAM}, Registrierung von ${registrierung.vorname} ${registrierung.nachname}`}>
        <Pencil
          className="size-4.5"
          aria-hidden="true"
        />
      </RowActionLink>
    </RowActions>
  );

  if (filteredRegistrierungen.length === 0) return <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />;

  return (
    /* Named here because no heading stands over it, and „Liste“ rather than „Tabelle“: these are cards. */
    <ul
      aria-label="Liste aller offenen Registrierungen"
      className="flex w-full flex-col gap-3">
      {filteredRegistrierungen.map((registrierung) => (
        <li
          key={registrierung.id}
          className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
          <div className="flex w-full flex-row items-center gap-3">
            <div className="min-w-0 flex-1">{renderIdentity(registrierung)}</div>
            {/* One of the two placements is hidden at any width, so the pair is one tab stop. */}
            <div className="hidden shrink-0 md:block">{renderActions(registrierung)}</div>
          </div>

          <div className="grid grid-cols-1 gap-3 border-t border-border/50 pt-3 md:grid-cols-3 md:gap-x-4">
            {renderFact(
              "Team",
              registrierung.teamName === null ? (
                <span className="fluid-sm">
                  <Leer />
                </span>
              ) : (
                <span className="truncate fluid-sm font-semibold text-foreground">{registrierung.teamName}</span>
              ),
            )}
            {renderFact("Saison", <span className="font-numeric fluid-sm text-foreground tabular-nums">{registrierung.saison_id}</span>)}
            {renderFact("Stufe", <span className="fluid-sm text-foreground">{registrierung.stufe ?? <Leer />}</span>)}
          </div>

          <div className="-mx-1 border-t border-border/50 pt-2 md:hidden">{renderActions(registrierung)}</div>
        </li>
      ))}
    </ul>
  );
});
