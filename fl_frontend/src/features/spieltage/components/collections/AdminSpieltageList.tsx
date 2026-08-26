"use client";

import { memo } from "react";
import Link from "next/link";

import { Calendar, Globe, Pencil } from "@gravity-ui/icons";

import { PHASE_LABELS, SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";
import { SaisonPhaseChip } from "@/features/spiele/components/ui/SaisonPhaseChip";
import { card } from "@/shared/components/ui/card";
import { RowActionLink, RowActions } from "@/shared/components/ui/RowActions";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";
import type { AdminSpieltagRow } from "../../types";
import type { SpieltagPhaseProgress } from "../../utils";

// An empty season names where its matchdays come from, because no control on this page makes one.
const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: "Keine Spieltage für diese Suche.",
  filtered: "Keine Spieltage für diese Filter.",
  none: "Für diese Saison gibt es noch keine Spieltage. Sie entstehen zusammen mit dem Spielplan.",
};

/**
 * The season's matchdays, sectioned by phase in the order they are played — **which arrives correct
 * and is not re-sorted here**. Memoised per `AdminCrudView`'s collection-identity note, though a
 * plain list has no react-aria collection to keep alive.
 */
export const AdminSpieltageList = memo(function AdminSpieltageList({
  filteredSpieltage,
  emptiness,
  saisonId,
  phaseProgress,
}: {
  filteredSpieltage: AdminSpieltagRow[];
  /** `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` carries what each value means. */
  emptiness: CrudEmptiness;
  /** The season the list is showing, for the outbound Spielplan link. Null where no season exists. */
  saisonId: string | null;
  /** Each phase's matchday count against what the season's rules imply. Absent where no season is. */
  phaseProgress?: readonly SpieltagPhaseProgress[];
}) {
  // A phase with no matchday is skipped rather than rendered empty: an empty heading reads as
  // something missing rather than something not reached.

  // No sort inside a section: re-sorting would be a second answer to a question the backend answered.
  const byPhase = new Map<FLSaisonPhase, AdminSpieltagRow[]>();
  for (const spieltag of filteredSpieltage) {
    const section = byPhase.get(spieltag.saison_phase);
    if (section) section.push(spieltag);
    else byPhase.set(spieltag.saison_phase, [spieltag]);
  }
  const sections = SAISON_PHASE_OPTIONS.filter((phase) => byPhase.has(phase)).map((phase) => ({
    phase,
    rows: byPhase.get(phase) ?? [],
  }));
  const progressByPhase = new Map((phaseProgress ?? []).map((entry) => [entry.phase, entry]));

  /**
   * **From the season-wide counts the headings read, never from the rows**: taken from the rows,
   * `?phase=finale` had this line naming every phase empty while the heading reported the season.
   * `erwartet > 0` keeps a round the bracket does not reach off it.
   */
  const phasesWithout = SAISON_PHASE_OPTIONS.filter((phase) => {
    const progress = progressByPhase.get(phase);
    return progress !== undefined && progress.erwartet > 0 && progress.angelegt === 0;
  });

  /**
   * **The heading and the rows count different populations, and neither bounds the other**: the
   * heading counts the season's matchdays, the rows whatever the search and facets left.
   */
  const renderPhaseCount = (phase: FLSaisonPhase, shownCount: number) => {
    const progress = progressByPhase.get(phase);
    if (progress === undefined) {
      // Defensive, not a state this page reaches: `Map.get` needs narrowing, and a resolved season's
      // schedule always holds the group phase.
      return <span className="muted-meta">{shownCount === 1 ? "1 Spieltag" : `${String(shownCount)} Spieltage`}</span>;
    }

    // The second number earns attention only where it disagrees: `erwartet` is derived per read from
    // the season's rules, so agreement is the ordinary season, and repeating the count on every
    // healthy heading spends what the divergence needs.
    if (progress.angelegt === progress.erwartet) {
      return (
        <span className="fluid-xs text-foreground-muted font-medium">
          {progress.angelegt === 1 ? "1 Spieltag" : `${String(progress.angelegt)} Spieltage`}
        </span>
      );
    }

    // The noun agrees with the EXPECTED count, the number it belongs to: „2 von 1 Spieltag“.
    const noun = progress.erwartet === 1 ? "Spieltag" : "Spieltagen";

    return (
      <span className="fluid-xs text-warning-strong font-medium">
        {progress.angelegt} von {progress.erwartet} {noun}
      </span>
    );
  };

  const renderActions = (spieltag: AdminSpieltagRow) => (
    <RowActions>
      {/* `spieltag` as `buildSpielFacets` declares it: `phase` would answer with the whole group stage
          for a Gruppenphase row. The season rides along because the search is scoped to one, and the
          row's own is the season its fixtures are in. */}
      <RowActionLink
        href={`/admin/spielsuche?spieltag=${spieltag.id}&saison_id=${encodeURIComponent(spieltag.saison_id)}`}
        label="Spiele anzeigen"
        ariaLabel={`${spieltag.label}: Spiele anzeigen`}>
        <Calendar
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      {/* A link rather than a press: the matchday form edits on a page, so the pencil is
          a navigation and the shared view renders no edit overlay. */}
      <RowActionLink
        href={`/admin/spieltage/${spieltag.id}`}
        label="Bearbeiten"
        ariaLabel={`${spieltag.label} bearbeiten`}>
        <Pencil
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
    </RowActions>
  );

  if (filteredSpieltage.length === 0) {
    return (
      <div className={`${card()} flex w-full flex-col items-center justify-center gap-3 py-16 text-center`}>
        <p className="muted-hint">{EMPTY_MESSAGES[emptiness]}</p>
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
              bar's. */}
          <h2 className="flex flex-row items-center gap-x-3">
            <SaisonPhaseChip saisonPhase={phase} />
            {renderPhaseCount(phase, rows.length)}
          </h2>

          <ul className="flex w-full flex-col gap-3">
            {rows.map((spieltag) => (
              <li
                key={spieltag.id}
                className={`${card()} flex w-full flex-col gap-y-3 p-4 md:flex-row md:items-center md:gap-x-4 md:gap-y-0`}>
                {/* The position and the identity share one row at EVERY width: a number belongs
                    beside the thing it numbers, and its own phone row spends a whole row on one
                    digit. From `md` that row starts the horizontal layout. */}
                <div className="flex min-w-0 flex-1 flex-row items-center gap-x-3">
                  <span
                    aria-hidden="true"
                    className="bg-brand-solid text-brand-solid-foreground fluid-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-extrabold shadow-sm">
                    {spieltag.position}
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col gap-y-1">
                    {/* The position is decorative for a screen reader — the list order already carries it,
                        and reading "1" before every name is noise. The name is the row's accessible
                        identity, which is what the action labels name too. */}
                    <span className="fluid-sm text-foreground truncate font-semibold">{spieltag.label}</span>
                    {/* The undated matchday comes FIRST: its two nulls are equal, so the one-day
                        branch below would render its absence as a single placeholder date. A range
                        repeating one date twice reads as two facts. */}
                    <span className="fluid-xs text-foreground-muted">
                      {spieltag.beginn === null && spieltag.ende === null
                        ? "Noch kein Zeitraum"
                        : spieltag.beginn === spieltag.ende
                          ? formatSpielDatum(spieltag.beginn)
                          : `${formatSpielDatum(spieltag.beginn)} – ${formatSpielDatum(spieltag.ende)}`}
                    </span>
                  </div>
                </div>

                <div className="border-border/50 -mx-1 border-t pt-2 md:mx-0 md:shrink-0 md:border-t-0 md:pt-0">{renderActions(spieltag)}</div>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* Named once at the foot rather than as empty headings between the sections that have one:
          a season reaches its phases in order, so "not there yet" is normal. Unconditional, because
          `phasesWithout` reads counts no search or facet moves. */}
      {phasesWithout.length > 0 && <p className="muted-meta">Ohne Spieltag: {phasesWithout.map((phase) => PHASE_LABELS[phase]).join(", ")}.</p>}

      {/* One link out, at the foot: the same matchdays as a visitor sees them, which is the check that the
          sequence above actually produces the schedule somebody will read. */}
      {saisonId !== null && (
        <Link
          href={`/dashboard/spielplan?saison_id=${encodeURIComponent(saisonId)}`}
          className="border-border bg-surface text-foreground hover:bg-hover fluid-xs flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
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
