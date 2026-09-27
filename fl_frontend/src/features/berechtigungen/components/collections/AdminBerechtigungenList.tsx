"use client";

import { memo } from "react";

import Key from "@gravity-ui/icons/Key";

import {
  BERECHTIGUNGEN_CRUD_COPY,
  ERTEILT_AM_LABEL,
  ERTEILT_VON_LABEL,
  GESPERRTE_ADRESSE,
  INHABER_LABEL,
} from "@/features/berechtigungen/constants";
import { AdminCrudEmptyCard } from "@/shared/components/ui/AdminCrudEmpty";
import { IDENTITY_HEAD_CLASSES, IDENTITY_NAME_CLASSES, IDENTITY_ROW_CLASSES, IDENTITY_STACK_CLASSES } from "@/shared/components/ui/adminTable";
import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { formatSpielDatum } from "@/shared/utils/format";

import { AdminBerechtigungEntziehenPanel } from "../forms/AdminBerechtigungEntziehenPanel";

import type { FLBerechtigungZeile } from "@/features/berechtigungen/schemas";
import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: BERECHTIGUNGEN_CRUD_COPY.emptyForQuery,
  // The search sentence: nothing but the bar narrows this list, so `filtered` is German no reader reaches.
  filtered: BERECHTIGUNGEN_CRUD_COPY.emptyForQuery,
  none: BERECHTIGUNGEN_CRUD_COPY.emptyOverall,
};

/** The eyebrow naming the fact at the fact, as the ban list's cards carry it. */
const FACT_LABEL_CLASSES = "fluid-xxs font-extrabold tracking-widest text-foreground-muted uppercase";

/**
 * **A card per grant at every width, as the ban list's**: the page beside it in the menu, and the
 * same few rows. Memoised per `AdminCrudView`'s collection-identity note.
 */
export const AdminBerechtigungenList = memo(function AdminBerechtigungenList({
  filteredBerechtigungen,
  emptiness,
  darfEntziehen,
}: {
  filteredBerechtigungen: FLBerechtigungZeile[];
  emptiness: CrudEmptiness;
  /** Whether the signed-in administrator may revoke, which only an `owner` grant may: everybody else is shown no control. */
  darfEntziehen: boolean;
}) {
  if (filteredBerechtigungen.length === 0) return <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />;

  return (
    /* Named here because no heading stands over it, and „Liste“ rather than „Tabelle“: these are cards. */
    <ul
      aria-label="Liste aller Zugänge"
      className="flex w-full flex-col gap-3">
      {filteredBerechtigungen.map((berechtigung) => (
        <li
          key={berechtigung.id}
          className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
          <div className={IDENTITY_ROW_CLASSES}>
            <Key
              aria-hidden="true"
              className="size-4.5 shrink-0 text-foreground-muted"
            />
            <div className={IDENTITY_STACK_CLASSES}>
              <div className={IDENTITY_HEAD_CLASSES}>
                {/* A barred address is withheld on every route, so the row names the state instead. */}
                <span className={IDENTITY_NAME_CLASSES}>{berechtigung.adresse ?? GESPERRTE_ADRESSE}</span>
                {berechtigung.verwaltung === "owner" && <span className={labelBadge("info")}>{INHABER_LABEL}</span>}
              </div>
            </div>
          </div>

          <div className="grid w-full grid-cols-1 gap-3 border-t border-border/50 pt-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <span className={FACT_LABEL_CLASSES}>{ERTEILT_VON_LABEL}</span>
              <p className="fluid-sm font-medium break-words text-foreground">{berechtigung.erteilt_von}</p>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className={FACT_LABEL_CLASSES}>{ERTEILT_AM_LABEL}</span>
              <p className="font-numeric fluid-sm font-medium text-foreground tabular-nums">
                {formatSpielDatum(berechtigung.erteilt_am.slice(0, 10))}
              </p>
            </div>
          </div>

          {/* No control on an `owner` grant, which no request changes: a press there could only be refused. */}
          {darfEntziehen && berechtigung.verwaltung !== "owner" && (
            <div className="-mx-1 border-t border-border/50 pt-2">
              <AdminBerechtigungEntziehenPanel berechtigungId={berechtigung.id} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
});
