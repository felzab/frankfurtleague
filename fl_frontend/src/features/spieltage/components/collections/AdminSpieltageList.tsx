"use client";

import { memo, useTransition } from "react";
import Link from "next/link";

import { Globe } from "@gravity-ui/icons";

import { PHASE_LABELS, SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";
import { SaisonPhaseChip } from "@/features/spiele/components/ui/SaisonPhaseChip";
import { reactivateSpieltagAction } from "@/features/spieltage/actions";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";
import { RowActionDelete, RowActionEdit, RowActionRestore, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSaisonPhase } from "@/features/saisons/schemas";
import type { AdminSpieltagRow } from "../../types";

/**
 * The season's matchdays, sectioned by phase and in the order they are played.
 *
 * **Not a table, and not the public Spielplan's tab strip either** (owner, 2026-08-07, ADR-0063). The
 * Spielplan shows one matchday at a time because a reader's question is what is being played on it; the
 * admin's questions are comparisons BETWEEN matchdays — are the phases right, does the expected fixture
 * count match what is attached — and a strip showing one matchday hides both.
 *
 * **The order arrives already correct and this list does not re-sort it** (ADR-0064). It is derived on the
 * backend from `saison_phase` in bracket order, then `beginn`, then `name`, so there is no stored position
 * to render, no collision to detect and no reordering control to offer. What the row shows instead is an
 * `ordinal` — its 1-based place within its phase section, assigned by the page from the order it received.
 * That number is presentation: two rows cannot claim the same one, and nothing can make it disagree with
 * where the row actually is.
 *
 * **`spieleAngelegt` against `anzahl_spiele` is the one fact only this surface can catch.** The expected
 * count follows from the season's rules and this matchday's phase (ADR-0065); the attached count is how
 * many fixtures carry its id. Nothing refuses a disagreement, because a season being set up passes through
 * every intermediate count on the way — so showing the two together is what makes the gap visible without
 * making the intermediate states illegal.
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

  // Grouped by phase in the competition's own order. A phase with no matchday is skipped rather than
  // rendered empty: a season part-way through its setup has no Finale yet, and an empty heading would read
  // as something missing rather than as something not reached.
  //
  // No sort inside a section — the rows arrive in the played order and re-sorting here would be a second
  // answer to a question the backend already answered (ADR-0064).
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
  const phasesWithout = SAISON_PHASE_OPTIONS.filter((phase) => !byPhase.has(phase));

  /** The derived expectation against what is actually attached — the one number only this list can check. */
  const renderSpieleCount = (spieltag: AdminSpieltagRow) => {
    const matches = spieltag.spieleAngelegt === spieltag.anzahl_spiele;
    // The noun agrees with the EXPECTED count, which is the number it belongs to: a final expects one
    // match, so the badge reads „1 / 1 Spiel“.
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
      <RowActionEdit
        label="Bearbeiten"
        ariaLabel={`${spieltag.label} bearbeiten`}
        onPress={() => onEdit(spieltag)}
      />
      {spieltag.inactive_since !== null ? (
        <RowActionRestore
          label="Reaktivieren"
          ariaLabel={`${spieltag.label} reaktivieren`}
          onPress={() => handleReactivate(spieltag)}
        />
      ) : (
        <RowActionDelete
          // Not offered while the matchday holds a result: retiring it would take that result off the
          // public Spielplan, which `REQ-RETIRE-002` refuses. The tooltip carries the reason, because a
          // disabled control with the live wording explains nothing.
          isDisabled={spieltag.spieleGespielt > 0}
          label={
            spieltag.spieleGespielt > 0
              ? `Nicht möglich: ${spieltag.spieleGespielt === 1 ? "1 Spiel hat" : `${String(spieltag.spieleGespielt)} Spiele haben`} schon ein Ergebnis`
              : "Stilllegen"
          }
          ariaLabel={`${spieltag.label} stilllegen`}
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
                {/* The ordinal and the identity share one row at EVERY width (owner, 2026-08-07). A
                    number belongs beside the thing it numbers, and giving it a phone row of its own
                    spends a whole row on one digit. From `md` the same row is the start of the
                    horizontal layout, so one wrapper serves both. */}
                <div className="flex min-w-0 flex-1 flex-row items-center gap-x-3">
                  <span
                    aria-hidden="true"
                    className="bg-brand/50 text-foreground fluid-sm flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-extrabold shadow-sm">
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
                        : `${formatSpielDatum(spieltag.beginn)} bis ${formatSpielDatum(spieltag.ende)}`}
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

      {/* The phases this season has no matchday for, named once at the foot rather than as empty headings
          between the sections that do: a season being set up reaches them in order, so "not there yet" is
          the normal state and belongs as a quiet line rather than as gaps. Suppressed while a search or a
          filter is narrowing the list, where an absent phase says something about the query instead. */}
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
