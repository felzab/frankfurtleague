"use client";

import { memo, useTransition } from "react";
import Link from "next/link";

import { Globe } from "@gravity-ui/icons";

import { PHASE_LABELS, SaisonPhaseChip } from "@/features/spiele/components/ui/SaisonPhaseChip";
import { reactivateSpieltagAction } from "@/features/spieltage/actions";
import { SAISON_PHASE_OPTIONS } from "@/features/spieltage/constants";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";
import { RowActionDelete, RowActionEdit, RowActionRestore, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { AdminSpieltagRow } from "../../types";

/**
 * The season's matchdays, sectioned by phase and ordered within a section by `order_val`.
 *
 * **Not a table, and not the public Spielplan's tab strip either** (owner, 2026-08-07, ADR-0063). The
 * Spielplan shows one matchday at a time because a reader's question is what is being played on it; the
 * admin's questions are all comparisons BETWEEN matchdays — does the sequence run clean, are the phases in
 * bracket order, does the expected fixture count match what is attached — and a strip showing one matchday
 * hides every one of them. A flat table would show the fields and hide the structure: a column of integers
 * reading 0, 1, 2, 3, 3, 5 is exactly the presentation in which the duplicate and the gap do not register.
 *
 * So the list is the season's skeleton: one section per phase in the order a season runs them, each row
 * leading with its position as a rank marker rather than as a sortable number, and the two facts nothing
 * else in the system can catch marked on the row itself.
 *
 * **Those two marks are the point of the surface.**
 *
 * `hasOrderCollision` — nothing in the database or the API makes `order_val` unique within a season, and
 * the bracket orders by it, so two matchdays sharing a position sort against each other by `beginn` as a
 * tie-break and the playoff rounds interleave. Nothing else reports it.
 *
 * `spieleAngelegt` against `anzahl_spiele` — the stored count is hand-maintained and written as given,
 * never derived, which ADR-0026 pointedly did not extend to it. Showing it beside the fixtures actually
 * carrying this matchday's id is the only way that drift becomes visible.
 *
 * **No drag-to-reorder** (owner, 2026-08-07). Renumbering a season is several writes and
 * `PATCH /spieltage/{spieltag_id}` writes one document, which is the shape ADR-0057 refused for the
 * whole-draw save; it would need a transactional bulk endpoint that does not exist. Matchdays are laid out
 * about twice a year, so the position is a field on the edit form.
 *
 * **No per-row link to a matchday's fixtures**, and that is a fact about the Spielsuche rather than a gap
 * here: it searches team, venue, date, fixture number and referee, and a matchday's name is none of those,
 * so `?q=<name>` would land on an empty list. The public Spielplan at the foot is the outbound link that
 * works, and it is per season because that is the granularity a URL can address.
 *
 * Memoised for the reason `AdminCrudView`'s collection-identity note gives — though a plain list has no
 * react-aria collection to keep alive, so here the memo is only the cheap re-render saving.
 */
export const AdminSpieltageList = memo(function AdminSpieltageList({
  spieltageQuery,
  filteredSpieltage,
  saisonId,
  onEdit,
  onDelete,
}: {
  spieltageQuery: string;
  filteredSpieltage: AdminSpieltagRow[];
  /** The season the list is showing, for the outbound Spielplan link. Null where no season exists. */
  saisonId: string | null;
  onEdit: (spieltag: AdminSpieltagRow) => void;
  onDelete: (spieltag: AdminSpieltagRow) => void;
}) {
  const [, startReactivating] = useTransition();

  // One press, then a toast either way. No confirmation step: reactivation is undone by the retire control
  // that takes its place.
  const handleReactivate = (spieltag: AdminSpieltagRow) => {
    startReactivating(async () => {
      const res = await reactivateSpieltagAction({ id: spieltag.id });
      if (res.success) appToast.success(res.message ?? "Spieltag reaktiviert.");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error });
    });
  };

  // Grouped by phase in the competition's own order, and a phase with no matchday is skipped rather than
  // rendered empty: a season part-way through its setup has no Finale yet, and an empty heading would read
  // as something missing rather than as something not reached.
  const byPhase = new Map<FLSaisonPhase, AdminSpieltagRow[]>();
  for (const spieltag of filteredSpieltage) {
    const section = byPhase.get(spieltag.saison_phase);
    if (section) section.push(spieltag);
    else byPhase.set(spieltag.saison_phase, [spieltag]);
  }
  const sections = SAISON_PHASE_OPTIONS.filter((phase) => byPhase.has(phase)).map((phase) => ({
    phase,
    // Within a phase, position first and then date — the same tie-break the backend applies, so the list
    // and the bracket read a duplicated position identically.
    rows: [...(byPhase.get(phase) ?? [])].sort((left, right) => left.order_val - right.order_val || left.beginn.localeCompare(right.beginn)),
  }));
  const phasesWithout = SAISON_PHASE_OPTIONS.filter((phase) => !byPhase.has(phase));

  /** The stored expectation against what is actually attached — the one number only this list can check. */
  const renderSpieleCount = (spieltag: AdminSpieltagRow) => {
    const matches = spieltag.spieleAngelegt === spieltag.anzahl_spiele;

    return (
      <IconTooltip
        label={
          matches
            ? `${String(spieltag.spieleAngelegt)} von ${String(spieltag.anzahl_spiele)} erwarteten Spielen angelegt.`
            : `${String(spieltag.spieleAngelegt)} Spiele angelegt, erwartet sind ${String(spieltag.anzahl_spiele)}.`
        }
        tone={matches ? undefined : "danger"}>
        <span className={`${LABEL_BADGE} cursor-help ${matches ? "bg-success/15 text-success-strong" : "bg-warning/15 text-warning-strong"}`}>
          {spieltag.spieleAngelegt} / {spieltag.anzahl_spiele} Spiele
        </span>
      </IconTooltip>
    );
  };

  const renderActions = (spieltag: AdminSpieltagRow) => (
    <RowActions>
      <RowActionEdit
        label="Bearbeiten"
        ariaLabel={`Spieltag ${spieltag.name} bearbeiten`}
        onPress={() => onEdit(spieltag)}
      />
      {spieltag.inactive_since !== null ? (
        <RowActionRestore
          label="Reaktivieren"
          ariaLabel={`Spieltag ${spieltag.name} reaktivieren`}
          onPress={() => handleReactivate(spieltag)}
        />
      ) : (
        <RowActionDelete
          label="Stilllegen"
          ariaLabel={`Spieltag ${spieltag.name} stilllegen`}
          onPress={() => onDelete(spieltag)}
        />
      )}
    </RowActions>
  );

  if (filteredSpieltage.length === 0) {
    return (
      <div className={`${card()} flex w-full flex-col items-center justify-center gap-3 py-16 text-center`}>
        <p className="fluid-sm text-foreground-muted font-medium">
          {spieltageQuery ? "Keine Spieltage für diese Suche gefunden." : "Für diese Saison wurden noch keine Spieltage angelegt."}
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-6">
      {sections.map(({ phase, rows }) => (
        <section
          key={phase}
          className="flex w-full flex-col gap-3">
          {/* The phase's own chip as the section heading, so the admin list and every match card name a
              phase with the same word and the same colour. `h2` because the page's title is the shell
              bar's (ADR-0058). */}
          <h2 className="flex flex-row items-center gap-x-3">
            <SaisonPhaseChip saisonPhase={phase} />
            <span className="fluid-xs text-foreground-muted font-medium">
              {rows.length === 1 ? "1 Spieltag" : `${String(rows.length)} Spieltage`}
            </span>
          </h2>

          <ul className="flex w-full flex-col gap-3">
            {rows.map((spieltag) => (
              <li
                key={spieltag.id}
                className={`${card()} flex w-full flex-col gap-y-3 p-4 md:flex-row md:items-center md:gap-x-4 md:gap-y-0 ${
                  spieltag.inactive_since !== null ? "opacity-80" : ""
                }`}>
                {/* The position leads the row because it is what the row is ordered by, and it is a
                    marker rather than a number in a cell because its value only means anything relative
                    to its neighbours. It turns warning-toned on a collision, which is the one state in
                    which the number itself is the problem. */}
                <span
                  aria-label={`Reihenfolge ${String(spieltag.order_val)}`}
                  className={`fluid-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-extrabold shadow-sm ${
                    spieltag.hasOrderCollision ? "bg-warning/20 text-warning-strong" : "bg-brand/50 text-foreground"
                  }`}>
                  {spieltag.order_val}
                </span>

                <div className="flex min-w-0 flex-1 flex-col gap-y-1">
                  <span className="fluid-sm text-foreground truncate font-semibold">{spieltag.name}</span>
                  {/* One date where the matchday is one day, which most are — a range repeating the same
                      date twice reads as two facts. */}
                  <span className="fluid-xs text-foreground-muted">
                    {spieltag.beginn === spieltag.ende
                      ? formatSpielDatum(spieltag.beginn)
                      : `${formatSpielDatum(spieltag.beginn)} bis ${formatSpielDatum(spieltag.ende)}`}
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 md:shrink-0">
                  {renderSpieleCount(spieltag)}
                  {spieltag.hasOrderCollision && (
                    <IconTooltip
                      label="Ein anderer Spieltag dieser Saison trägt dieselbe Reihenfolge. Die beiden sortieren dann nach Beginn."
                      tone="danger">
                      <span className={`${LABEL_BADGE} bg-warning/15 text-warning-strong cursor-help`}>Reihenfolge doppelt</span>
                    </IconTooltip>
                  )}
                  {spieltag.inactive_since !== null && (
                    <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>
                      Stillgelegt seit {formatSpielDatum(spieltag.inactive_since)}
                    </span>
                  )}
                </div>

                <div className="border-border/50 -mx-1 border-t pt-2 md:mx-0 md:shrink-0 md:border-t-0 md:pt-0">{renderActions(spieltag)}</div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* The phases this season has no matchday for, named once at the foot rather than as empty headings
          between the sections that do: a season being set up reaches them in order, so "not there yet" is
          the normal state and belongs as a quiet line rather than as gaps. Suppressed while a search is
          running, where an absent phase says something about the query instead. */}
      {phasesWithout.length > 0 && spieltageQuery === "" && (
        <p className="fluid-xs text-foreground-muted font-medium">
          Ohne Spieltag: {phasesWithout.map((phase) => PHASE_LABELS[phase]).join(", ")}.
        </p>
      )}

      {/* One link out, at the foot: the same matchdays as a visitor sees them, which is the check that the
          sequence above actually produces the schedule somebody will read. */}
      {saisonId !== null && (
        <Link
          href={`/dashboard/spielplan?saison_id=${encodeURIComponent(saisonId)}`}
          className="border-border bg-surface text-foreground hover:bg-muted fluid-xs flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
          <Globe
            aria-hidden="true"
            width={16}
            height={16}
          />
          Öffentlichen Spielplan ansehen
        </Link>
      )}
    </div>
  );
});
