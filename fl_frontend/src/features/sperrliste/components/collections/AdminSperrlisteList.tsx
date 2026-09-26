"use client";

import { memo } from "react";

import Ban from "@gravity-ui/icons/Ban";

import { SPERRE_BIS_LABEL, sperreBisWert, SPERRLISTE_CRUD_COPY } from "@/features/sperrliste/constants";
import { AdminCrudEmptyCard } from "@/shared/components/ui/AdminCrudEmpty";
import { IDENTITY_HEAD_CLASSES, IDENTITY_LINE_CLASSES, IDENTITY_ROW_CLASSES, IDENTITY_STACK_CLASSES } from "@/shared/components/ui/adminTable";
import { card } from "@/shared/components/ui/card";
import { formatSpielDatum } from "@/shared/utils/format";

import { AdminSperreAufhebenPanel } from "../forms/AdminSperreAufhebenPanel";

import type { FLSperrlisteEintrag } from "@/features/sperrliste/schemas";
import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: SPERRLISTE_CRUD_COPY.emptyForQuery,
  // The search sentence and not one of its own: nothing but the bar narrows this list, so a sentence
  // written for `filtered` would be German no reader can reach.
  filtered: SPERRLISTE_CRUD_COPY.emptyForQuery,
  none: SPERRLISTE_CRUD_COPY.emptyOverall,
};

/** The eyebrow naming the fact at the fact, so no heading over the list can disagree with it. */
const FACT_LABEL_CLASSES = "fluid-xxs text-foreground-muted font-extrabold tracking-widest uppercase";

/**
 * **A card per ban at every width, never a table** (`docs/frontend/spec.md :: I237`). Memoised per
 * `AdminCrudView`'s collection-identity note.
 */
export const AdminSperrlisteList = memo(function AdminSperrlisteList({
  filteredSperren,
  emptiness,
}: {
  filteredSperren: FLSperrlisteEintrag[];
  /** `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` carries what each value means. */
  emptiness: CrudEmptiness;
}) {
  /* The day leads, being the one short token that tells two rows apart: the address is a keyed hash
     and the reason is a sentence. */
  const renderIdentity = (eintrag: FLSperrlisteEintrag) => (
    <div className={IDENTITY_ROW_CLASSES}>
      <Ban
        aria-hidden="true"
        className="size-4.5 shrink-0 text-foreground-muted"
      />
      <div className={IDENTITY_STACK_CLASSES}>
        <div className={IDENTITY_HEAD_CLASSES}>
          {/* `IDENTITY_NAME_CLASSES`'s box carries `truncate`, and a clipped year is a different date, so the
              day wears the grade `AdminBewerbungenList` gives one instead. */}
          <span className="font-numeric fluid-sm font-semibold text-foreground tabular-nums">{formatSpielDatum(eintrag.erstellt_am)}</span>
        </div>
        <span className={IDENTITY_LINE_CLASSES}>{eintrag.erstellt_von}</span>
      </div>
    </div>
  );

  if (filteredSperren.length === 0) return <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />;

  return (
    /* Named here because no heading stands over it, and „Liste“ rather than the „Tabelle“ every
       table collection says: these are cards. */
    <ul
      aria-label="Liste aller Sperren"
      className="flex w-full flex-col gap-3">
      {filteredSperren.map((eintrag) => (
        <li
          key={eintrag.id}
          className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
          {renderIdentity(eintrag)}

          {/* One track and not the neighbours' four: a reason is a sentence an administrator typed,
              and a column of a card's width clips it wherever it renders. */}
          <div className="flex w-full flex-col gap-1 border-t border-border/50 pt-3">
            <span className={FACT_LABEL_CLASSES}>Grund</span>
            <p className="fluid-sm font-medium text-foreground">{eintrag.grund}</p>
          </div>

          {/* Its own track under the reason rather than a line inside it: the bound is the one fact
              on the card an administrator compares against the running season. */}
          <div className="flex w-full flex-col gap-1 border-t border-border/50 pt-3">
            <span className={FACT_LABEL_CLASSES}>{SPERRE_BIS_LABEL}</span>
            <p className="fluid-sm font-medium text-foreground">{sperreBisWert(eintrag.gesperrt_bis_saison_id)}</p>
          </div>

          <div className="-mx-1 border-t border-border/50 pt-2">
            <AdminSperreAufhebenPanel
              sperreId={eintrag.id}
              gesperrtAm={formatSpielDatum(eintrag.erstellt_am)}
            />
          </div>
        </li>
      ))}
    </ul>
  );
});
