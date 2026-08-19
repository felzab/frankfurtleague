"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { AdminCreateSpieltagForm } from "@/features/spieltage/components/forms/AdminCreateSpieltagForm";
import { Callout } from "@/shared/components/ui/Callout";
import { DisabledHint } from "@/shared/components/ui/DisabledHint";
import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSaisonPhaseSchedule } from "@/features/saisons/schemas";

/**
 * **A matchday is created into the season the sidemenu selector holds**, which is why there is no season
 * picker in the form. The order is derived, so there is no next-free-position to compute either.
 *
 * TWO states in which no matchday can be created, and the dialog refuses BEFORE the request in both
 * (decided 2026-08-08). `saisonId` is null where the league has no seasons at all — a fresh database — and
 * the dialog says so rather than offering a form that cannot submit. And `REQ-SPIELTAG-003` refuses the
 * create once the season's knockout phase is under way, which the page can see: `knockoutBeginn` is the
 * earliest non-group matchday's start, so the trigger is disabled with the reason on it rather than
 * opening onto a 409.
 *
 * The endpoint remains the authority. A page left open past midnight, or a knockout matchday re-dated in
 * another tab, both reach it — and `mapSpieltagRefusal` answers in German when they do.
 */
export function AdminCreateSpieltagModal({
  saisonId,
  saisonSpan,
  saisonSchedule,
  knockoutBeginn,
  today,
}: {
  saisonId: string | null;
  /** The season's own span, which bounds both date pickers (`REQ-DATE-002`). */
  saisonSpan?: { start: string; end: string };
  /** The season's derived per-phase match counts, shown beside each phase in the picker. */
  saisonSchedule?: readonly FLSaisonPhaseSchedule[];
  /** The earliest non-group matchday's `beginn`, or null where the season has none. */
  knockoutBeginn: string | null;
  today: string;
}) {
  const modalState = useOverlayState();

  // Inclusive, matching `find_spieltag_create_refusal`: a bracket beginning today is under way. Both are
  // `YYYY-MM-DD`, which is why a string comparison is the right one.
  const knockoutRefusal =
    knockoutBeginn !== null && knockoutBeginn <= today
      ? `Die KO-Runde dieser Saison läuft seit dem ${formatSpielDatum(knockoutBeginn)}. Danach lassen sich keine Spieltage mehr anlegen.`
      : null;

  return (
    <>
      {/* Below the header row rather than above it: this trigger sits at the top of the page, where a
          panel placed on top would open off-screen. */}
      <DisabledHint
        reason={knockoutRefusal}
        placement="bottom"
        // The wrapper is the header row's flex item now, and below `sm` this trigger is the search
        // bar's own continuation: shrink it and the shared seam opens.
        className="shrink-0">
        <Button
          onPress={modalState.open}
          isDisabled={knockoutRefusal !== null}
          className={formButton({ intent: "trigger" })}>
          <Plus
            width={18}
            height={18}
          />
          {/* Below `sm` the trigger is the bare plus continuing the search bar (decided 2026-08-07), so
              the label is the one thing that cannot carry the refusal at that width. */}
          <span className="hidden sm:inline">Neuen Spieltag anlegen</span>
        </Button>
      </DisabledHint>

      <FormModal
        isOpen={modalState.isOpen}
        onClose={modalState.close}
        heading={saisonId === null ? "Spieltag anlegen" : `Spieltag der Saison ${saisonId} anlegen`}>
        {saisonId === null ? (
          <Callout
            severity="info"
            title="Keine Saison angelegt">
            Ein Spieltag gehört zu einer Saison und trägt ihre ID. Lege zuerst eine Saison an.
          </Callout>
        ) : (
          <AdminCreateSpieltagForm
            saisonId={saisonId}
            saisonSpan={saisonSpan}
            saisonSchedule={saisonSchedule}
            onClose={modalState.close}
          />
        )}
      </FormModal>
    </>
  );
}
