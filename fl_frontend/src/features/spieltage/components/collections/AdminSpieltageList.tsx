"use client";

import { memo, useTransition } from "react";
import Link from "next/link";

import { Globe, Pencil } from "@gravity-ui/icons";

import { PHASE_LABELS, SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";
import { SaisonPhaseChip } from "@/features/spiele/components/ui/SaisonPhaseChip";
import { reactivateSpieltagAction } from "@/features/spieltage/actions";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";
import { RowActionDelete, RowActionLink, RowActionRestore, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { AdminSpieltagRow } from "../../types";
import type { SpieltagPhaseProgress } from "../../utils";

/**
 * The season's matchdays, sectioned by phase in the order they are played — **which arrives correct
 * and is not re-sorted here**. Memoised per `AdminCrudView`'s collection-identity note, though a
 * plain list has no react-aria collection to keep alive.
 */
export const AdminSpieltageList = memo(function AdminSpieltageList({
  spieltageQuery,
  filteredSpieltage,
  saisonId,
  phaseProgress,
  onDelete,
}: {
  spieltageQuery: string;
  filteredSpieltage: AdminSpieltagRow[];
  /** The season the list is showing, for the outbound Spielplan link. Null where no season exists. */
  saisonId: string | null;
  /** Each phase's live matchday count against what the season's rules imply. Absent where no season is. */
  phaseProgress?: readonly SpieltagPhaseProgress[];
  onDelete: (spieltag: AdminSpieltagRow) => void;
}) {
  const [, startReactivating] = useTransition();

  // No confirmation step: reactivation is undone by the retire control that takes its place.
  const handleReactivate = (spieltag: AdminSpieltagRow) => {
    startReactivating(async () => {
      const res = await reactivateSpieltagAction({ id: spieltag.id });
      if (res.success) appToast.success(res.message ?? "Spieltag reaktiviert.");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
    });
  };

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
   * heading counts the season's LIVE matchdays, the rows whatever the search and facets left, retired
   * included — the trade for `phasesWithout` reading these too.
   */
  const renderPhaseCount = (phase: FLSaisonPhase, shownCount: number) => {
    const progress = progressByPhase.get(phase);
    if (progress === undefined) {
      // Defensive, not a state this page reaches: `Map.get` needs narrowing, and a resolved season's
      // schedule always holds the group phase.
      return <span className="muted-meta">{shownCount === 1 ? "1 Spieltag" : `${String(shownCount)} Spieltage`}</span>;
    }

    // The noun agrees with the EXPECTED count, the number it belongs to: „1 von 1 Spieltag“.
    const noun = progress.erwartet === 1 ? "Spieltag" : "Spieltagen";

    return (
      <span className={`fluid-xs font-medium ${progress.angelegt === progress.erwartet ? "text-foreground-muted" : "text-warning-strong"}`}>
        {progress.angelegt} von {progress.erwartet} {noun}
      </span>
    );
  };

  /** The derived expectation against what is attached — the per-matchday half of `renderPhaseCount`. */
  const renderSpieleCount = (spieltag: AdminSpieltagRow) => {
    const matches = spieltag.spieleAngelegt === spieltag.anzahl_spiele;
    // The noun agrees with the EXPECTED count, the number it belongs to: „1 / 1 Spiel“.
    const noun = spieltag.anzahl_spiele === 1 ? "Spiel" : "Spiele";

    return (
      <IconTooltip
        label={
          matches
            ? `${String(spieltag.spieleAngelegt)} von ${String(spieltag.anzahl_spiele)} erwarteten ${spieltag.anzahl_spiele === 1 ? "Spiel" : "Spielen"} angelegt.`
            : `${String(spieltag.spieleAngelegt)} angelegt, erwartet ${spieltag.anzahl_spiele === 1 ? "ist 1 Spiel" : `sind ${String(spieltag.anzahl_spiele)} Spiele`}.`
        }
        tone={matches ? undefined : "danger"}>
        <span className={`${LABEL_BADGE} cursor-help ${matches ? "bg-success/15 text-success-strong" : "bg-warning/15 text-warning-strong"}`}>
          {spieltag.spieleAngelegt} / {spieltag.anzahl_spiele} {noun}
        </span>
      </IconTooltip>
    );
  };

  const renderActions = (spieltag: AdminSpieltagRow) => (
    <RowActions>
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
      {spieltag.inactive_since !== null ? (
        <RowActionRestore
          label="Reaktivieren"
          ariaLabel={`${spieltag.label} reaktivieren`}
          onPress={() => handleReactivate(spieltag)}
        />
      ) : (
        <RowActionDelete
          // Not offered while the matchday holds a result: retiring it would take that result off the
          // public Spielplan, which `REQ-RETIRE-002` refuses.
          disabledReason={
            spieltag.spieleGespielt > 0
              ? `Stilllegen ist nicht möglich: ${spieltag.spieleGespielt === 1 ? "1 Spiel hat" : `${String(spieltag.spieleGespielt)} Spiele haben`} schon ein Ergebnis.`
              : null
          }
          label="Stilllegen"
          ariaLabel={`${spieltag.label} stilllegen`}
          onPress={() => onDelete(spieltag)}
        />
      )}
    </RowActions>
  );

  if (filteredSpieltage.length === 0) {
    return (
      <div className={`${card()} flex w-full flex-col items-center justify-center gap-3 py-16 text-center`}>
        <p className="muted-hint">
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
              bar's. */}
          <h2 className="flex flex-row items-center gap-x-3">
            <SaisonPhaseChip saisonPhase={phase} />
            {renderPhaseCount(phase, rows.length)}
          </h2>

          <ul className="flex w-full flex-col gap-3">
            {rows.map((spieltag) => (
              <li
                key={spieltag.id}
                className={`${card()} flex w-full flex-col gap-y-3 p-4 md:flex-row md:items-center md:gap-x-4 md:gap-y-0 ${
                  spieltag.inactive_since !== null ? "opacity-80" : ""
                }`}>
                {/* The ordinal and the identity share one row at EVERY width: a number belongs
                    beside the thing it numbers, and its own phone row spends a whole row on one
                    digit. From `md` that row starts the horizontal layout. */}
                <div className="flex min-w-0 flex-1 flex-row items-center gap-x-3">
                  <span
                    aria-hidden="true"
                    className="bg-brand-solid text-brand-solid-foreground fluid-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-extrabold shadow-sm">
                    {spieltag.ordinal}
                  </span>

                  <div className="flex min-w-0 flex-1 flex-col gap-y-1">
                    {/* The ordinal is decorative for a screen reader — the list order already carries it,
                        and reading "1" before every name is noise. The name is the row's accessible
                        identity, which is what the action labels name too. */}
                    <span className="fluid-sm text-foreground truncate font-semibold">{spieltag.label}</span>
                    {/* One date where the matchday is one day, which most are — a range repeating the same
                        date twice reads as two facts. */}
                    <span className="fluid-xs text-foreground-muted">
                      {spieltag.beginn === spieltag.ende
                        ? formatSpielDatum(spieltag.beginn)
                        : `${formatSpielDatum(spieltag.beginn)} – ${formatSpielDatum(spieltag.ende)}`}
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 md:shrink-0">
                  {renderSpieleCount(spieltag)}
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

      {/* Named once at the foot rather than as empty headings between the sections that have one:
          a season reaches its phases in order, so "not there yet" is normal. Unconditional, because
          `phasesWithout` reads counts no search or facet moves. */}
      {phasesWithout.length > 0 && (
        // „aktiven“ is load-bearing: `angelegt` counts live matchdays alone, so a phase whose
        // only matchday is retired is named here.
        <p className="muted-meta">Ohne aktiven Spieltag: {phasesWithout.map((phase) => PHASE_LABELS[phase]).join(", ")}.</p>
      )}

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
