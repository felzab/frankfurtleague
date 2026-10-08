"use client";

import { memo } from "react";

import Key from "@gravity-ui/icons/Key";

import { VonOderGesperrt } from "@/features/berechtigungen/components/ui/VonOderGesperrt";
import {
  BERECHTIGUNGEN_CRUD_COPY,
  DIREKT_IN_DER_DATENBANK,
  ERTEILT_AM_LABEL,
  ERTEILT_VON_LABEL,
  GESPERRTE_ADRESSE,
  INHABER_LABEL,
  PLAYGROUND_MARKER,
  vonOderGesperrt,
} from "@/features/berechtigungen/constants";
import { AdminCrudEmptyCard } from "@/shared/components/ui/AdminCrudEmpty";
import { IDENTITY_HEAD_CLASSES, IDENTITY_NAME_CLASSES, IDENTITY_ROW_CLASSES, IDENTITY_STACK_CLASSES } from "@/shared/components/ui/adminTable";
import { Leer } from "@/shared/components/ui/Angabe";
import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { focusRow, focusSection } from "@/shared/utils/focusAfterWrite";

import { AdminBerechtigungEntziehenPanel } from "../forms/AdminBerechtigungEntziehenPanel";
import { AdminBerechtigungStufePanel } from "../forms/AdminBerechtigungStufePanel";

import type { FLBerechtigungZeile } from "@/features/berechtigungen/schemas";
import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: BERECHTIGUNGEN_CRUD_COPY.emptyForQuery,
  // The search sentence: nothing but the bar narrows this list, so `filtered` is German no reader reaches.
  filtered: BERECHTIGUNGEN_CRUD_COPY.emptyForQuery,
  none: BERECHTIGUNGEN_CRUD_COPY.emptyOverall,
};

// Europe/Berlin, as every other date in this app is rendered: a grant made after 22:00 in summer is
// already the next day's in UTC.
const ERTEILT_TAG = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });

/** The Berlin day of `erteilt_am`. */
function erteiltTag(stamp: string): string {
  const instant = new Date(stamp);

  // A Playground paste writes what it likes, and `Intl.format` throws on an invalid date.
  return Number.isNaN(instant.getTime()) ? stamp : ERTEILT_TAG.format(instant);
}

/** Who granted it, as every admin card names an actor, and a paste naming nobody by its origin. */
function ErteiltVon({ erteilt_von, erteilt_von_gesperrt }: FLBerechtigungZeile) {
  const von = vonOderGesperrt(erteilt_von, erteilt_von_gesperrt);
  if (von === PLAYGROUND_MARKER || von === "") return DIREKT_IN_DER_DATENBANK;

  return (
    <VonOderGesperrt
      von={erteilt_von}
      gesperrt={erteilt_von_gesperrt}
    />
  );
}

/** The eyebrow naming the fact at the fact, as the ban list's cards carry it. */
const FACT_LABEL_CLASSES = "fluid-xxs font-extrabold tracking-widest text-foreground-muted uppercase";

/**
 * **A card per grant at every width, as the ban list's**: the page beside it in the menu, and the
 * same few rows. Memoised per `AdminCrudView`'s collection-identity note.
 */
export const AdminBerechtigungenList = memo(function AdminBerechtigungenList({
  filteredBerechtigungen,
  emptiness,
  inhaberAdresse,
}: {
  filteredBerechtigungen: FLBerechtigungZeile[];
  emptiness: CrudEmptiness;
  /**
   * The signed-in administrator's own folded address where their grant is `owner`, else `null`: only an
   * owner revokes or changes a tier, and their own row is the one they step down from.
   */
  inhaberAdresse: string | null;
}) {
  if (filteredBerechtigungen.length === 0) return <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />;

  return (
    /* Named here because no heading stands over it, and „Liste“ rather than „Tabelle“: these are cards. */
    <ul
      aria-label="Liste aller Zugänge"
      {...focusSection("zugaenge")}
      className="flex w-full flex-col gap-3">
      {filteredBerechtigungen.map((berechtigung) => (
        <li
          key={berechtigung.id}
          {...focusRow(berechtigung.id)}
          className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
          <div className={IDENTITY_ROW_CLASSES}>
            <Key
              aria-hidden="true"
              className="size-4.5 shrink-0 text-foreground-muted"
            />
            <div className={IDENTITY_STACK_CLASSES}>
              <div className={IDENTITY_HEAD_CLASSES}>
                {/* A barred address is withheld on every route, so the row names the state instead. */}
                <span className={IDENTITY_NAME_CLASSES}>{berechtigung.adresse ?? <Leer>{GESPERRTE_ADRESSE}</Leer>}</span>
                {berechtigung.verwaltung === "owner" && <span className={labelBadge("info")}>{INHABER_LABEL}</span>}
              </div>
            </div>
          </div>

          <div className="grid w-full grid-cols-1 gap-3 border-t border-border/50 pt-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <span className={FACT_LABEL_CLASSES}>{ERTEILT_VON_LABEL}</span>
              <p className="fluid-sm font-medium break-words text-foreground">
                <ErteiltVon {...berechtigung} />
              </p>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <span className={FACT_LABEL_CLASSES}>{ERTEILT_AM_LABEL}</span>
              <p className="font-numeric fluid-sm font-medium text-foreground tabular-nums">{erteiltTag(berechtigung.erteilt_am)}</p>
            </div>
          </div>

          {/* The tier change an owner's alone and shown to nobody else; the revoke on every grant but an `owner`
              one, which is demoted first, closed with its reason for a non-owner. */}
          {(inhaberAdresse !== null || berechtigung.verwaltung !== "owner") && (
            <div className="-mx-1 flex flex-col gap-3 border-t border-border/50 pt-2">
              {inhaberAdresse !== null && (
                <AdminBerechtigungStufePanel
                  berechtigungId={berechtigung.id}
                  adresse={berechtigung.adresse}
                  erteiltAm={erteiltTag(berechtigung.erteilt_am)}
                  verwaltung={berechtigung.verwaltung}
                  eigene={berechtigung.adresse === inhaberAdresse}
                />
              )}
              {berechtigung.verwaltung !== "owner" && (
                <AdminBerechtigungEntziehenPanel
                  berechtigungId={berechtigung.id}
                  adresse={berechtigung.adresse}
                  erteiltAm={erteiltTag(berechtigung.erteilt_am)}
                  darfEntziehen={inhaberAdresse !== null}
                />
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
});
