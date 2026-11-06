import Pencil from "@gravity-ui/icons/Pencil";

import { kaderName, NUMMER_DOUBLE, NUMMER_NOT_ON_FILE, retiredSince, rolleLabel } from "@/features/spieler/constants";
import {
  IDENTITY_HEAD_CLASSES,
  IDENTITY_LINE_CLASSES,
  IDENTITY_ROW_CLASSES,
  IDENTITY_STACK_CLASSES,
  identityName,
} from "@/shared/components/ui/adminTable";
import { labelBadge } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionLink, RowActions } from "@/shared/components/ui/RowActions";

import type { FLKaderRow } from "@/core/generated/client/types";

/**
 * **A card per squad row at every width, never a table**: a row is a record, and the squad joins no
 * admin roster. An ausgetragen row is listed with its day and no control: only the administrator
 * brings it back.
 */
export function KaderList({ kader, kaderHref }: { kader: readonly FLKaderRow[]; kaderHref: string }) {
  /** EMPTY rather than absent where the row has none: a missing chip reads as a rendering fault, not as „not filled in“. */
  const renderNummer = (row: FLKaderRow) => (
    <span
      // A fixed height: an empty span has no line box to size it.
      className={`inline-flex h-7 w-10 shrink-0 items-center justify-center rounded-md font-numeric fluid-xs font-extrabold tracking-wide ${
        row.nummer === null ? "bg-muted/50" : "bg-muted text-foreground"
      }`}>
      {/* Text, never an `aria-label`, which a screen reader ignores on a span with no role. */}
      {row.nummer ?? <span className="sr-only">{NUMMER_NOT_ON_FILE}</span>}
    </span>
  );

  const renderBadges = (row: FLKaderRow) => {
    if (row.inactive_since !== null) return <span className={labelBadge("warning")}>{retiredSince(row.inactive_since)}</span>;

    return (
      <>
        {row.rolle !== null && <span className={`${labelBadge("brandSolid")} shrink-0`}>{rolleLabel(row.rolle)}</span>}
        {row.is_nachnominiert && <span className={labelBadge("info")}>Nachnominiert</span>}
        {/* On both rows of the pair, the backend having composed it for each: either is where it is repaired. */}
        {row.nummer_double && <span className={labelBadge("warning")}>{NUMMER_DOUBLE}</span>}
      </>
    );
  };

  // Absent rather than punctuated where the row holds neither, so no card carries a stray separator.
  const renderMeta = (row: FLKaderRow) => {
    const parts = [row.position, row.stufe].filter((part) => part !== null);

    return parts.length === 0 ? null : <span className={IDENTITY_LINE_CLASSES}>{parts.join(" · ")}</span>;
  };

  return (
    // Named here because no heading stands over it but the shell's, as the contacts' card list is.
    <ul
      aria-label="Liste aller Kadereinträge"
      className="flex w-full flex-col gap-3">
      {kader.map((row) => (
        <li
          key={row.spieler_id}
          className={`${card()} flex w-full flex-row items-center gap-3 p-4`}>
          <div className={`${IDENTITY_ROW_CLASSES} flex-1`}>
            {renderNummer(row)}
            <div className={IDENTITY_STACK_CLASSES}>
              <div className={IDENTITY_HEAD_CLASSES}>
                <span className={identityName(row.inactive_since !== null)}>{kaderName(row)}</span>
                {renderBadges(row)}
              </div>
              {renderMeta(row)}
            </div>
          </div>

          {row.inactive_since === null && (
            <RowActions>
              <RowActionLink
                href={`${kaderHref}/${row.spieler_id}`}
                label="Bearbeiten"
                subject={`Kadereintrag von ${kaderName(row)}`}>
                <Pencil
                  className="size-4.5"
                  aria-hidden="true"
                />
              </RowActionLink>
            </RowActions>
          )}
        </li>
      ))}
    </ul>
  );
}
