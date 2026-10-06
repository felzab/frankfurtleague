import Pencil from "@gravity-ui/icons/Pencil";

import { ausgetragenSeit, kaderName, NUMMER_DOPPELT, OHNE_NUMMER, rolleLabel } from "@/features/spieler/constants";
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

import type { FLKaderZeile } from "@/features/spieler/schemas";

/**
 * **A card per squad row at every width, never a table**: a row is a record, and the squad joins no
 * admin roster. An ausgetragen row is listed with its day and no control: only the administrator
 * brings it back.
 */
export function KaderList({ kader, kaderHref }: { kader: readonly FLKaderZeile[]; kaderHref: string }) {
  /** EMPTY rather than absent where the row has none, for `fl_frontend/src/features/spieler/components/collections/AdminSpielerTable.tsx`' reason. */
  const renderNummer = (zeile: FLKaderZeile) => (
    <span
      // A fixed height, as the admin list's chip: an empty span has no line box to size it.
      className={`inline-flex h-7 w-10 shrink-0 items-center justify-center rounded-md font-numeric fluid-xs font-extrabold tracking-wide tabular-nums ${
        zeile.nummer === null ? "bg-muted/50" : "bg-muted text-foreground"
      }`}>
      {/* Text, never an `aria-label`, which a screen reader ignores on a span with no role. */}
      {zeile.nummer ?? <span className="sr-only">{OHNE_NUMMER}</span>}
    </span>
  );

  const renderBadges = (zeile: FLKaderZeile) => {
    if (zeile.inactive_since !== null) return <span className={labelBadge("warning")}>{ausgetragenSeit(zeile.inactive_since)}</span>;

    return (
      <>
        {zeile.rolle !== null && <span className={`${labelBadge("brandSolid")} shrink-0`}>{rolleLabel(zeile.rolle)}</span>}
        {zeile.ist_nachnominiert && <span className={labelBadge("info")}>Nachnominiert</span>}
        {/* On both rows of the pair, the backend having composed it for each: either is where it is repaired. */}
        {zeile.nummer_doppelt && <span className={labelBadge("warning")}>{NUMMER_DOPPELT}</span>}
      </>
    );
  };

  // Absent rather than punctuated where the row holds neither, so no card carries a stray separator.
  const renderMeta = (zeile: FLKaderZeile) => {
    const parts = [zeile.position, zeile.stufe].filter((part) => part !== null);

    return parts.length === 0 ? null : <span className={IDENTITY_LINE_CLASSES}>{parts.join(" · ")}</span>;
  };

  return (
    // Named here because no heading stands over it but the shell's, as the contacts' card list is.
    <ul
      aria-label="Liste aller Kadereinträge"
      className="flex w-full flex-col gap-3">
      {kader.map((zeile) => (
        <li
          key={zeile.spieler_id}
          className={`${card()} flex w-full flex-row items-center gap-3 p-4`}>
          <div className={`${IDENTITY_ROW_CLASSES} flex-1`}>
            {renderNummer(zeile)}
            <div className={IDENTITY_STACK_CLASSES}>
              <div className={IDENTITY_HEAD_CLASSES}>
                <span className={identityName(zeile.inactive_since !== null)}>{kaderName(zeile)}</span>
                {renderBadges(zeile)}
              </div>
              {renderMeta(zeile)}
            </div>
          </div>

          {zeile.inactive_since === null && (
            <RowActions>
              <RowActionLink
                href={`${kaderHref}/${zeile.spieler_id}`}
                label="Bearbeiten"
                subject={`Kadereintrag von ${kaderName(zeile)}`}>
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
