"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { AdminCreateSpieltagForm } from "@/features/spieltage/components/forms/AdminCreateSpieltagForm";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

import type { FLSaisonPhaseSchedule } from "@/features/saisons/schemas";

/**
 * **A matchday is created into the season the sidemenu selector holds**, which is why there is no season
 * picker in the form. The order is derived, so there is no next-free-position to compute either (ADR-0051).
 *
 * TWO states in which no matchday can be created, and the dialog refuses BEFORE the request in both
 * (decided 2026-08-08). `saisonId` is null where the league has no seasons at all — a fresh database — and
 * the dialog says so rather than offering a form that cannot submit. And `REQ-SPIELTAG-003` refuses the
 * create once the season's knockout phase is under way, which the page can see: `knockoutBeginn` is the
 * earliest non-group matchday's start, so the trigger is disabled with the reason in its own label instead
 * of opening onto a 409.
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
  const isKnockoutUnderWay = knockoutBeginn !== null && knockoutBeginn <= today;

  return (
    <>
      {/* The full reason on a WRAPPER, not on the button. HeroUI's `Button` takes no `title`, and
          react-aria fires no hover events on a disabled control -- so a tooltip component would never
          open on the one state that needs explaining. A native title on the span does. */}
      <span
        title={
          isKnockoutUnderWay
            ? `Die KO-Runde dieser Saison läuft seit dem ${knockoutBeginn ?? ""}. Danach lassen sich keine Spieltage mehr anlegen.`
            : undefined
        }>
        <Button
          onPress={modalState.open}
          isDisabled={isKnockoutUnderWay}
          className={formButton({ intent: "trigger" })}>
          <Plus
            width={18}
            height={18}
          />
          {/* Below `sm` the trigger is the bare plus continuing the search bar (decided 2026-08-07). The
              disabled label replaces it rather than sitting beside it: a disabled control whose wording is
              unchanged says nothing about why. */}
          <span className="hidden sm:inline">{isKnockoutUnderWay ? "KO-Runde läuft" : "Neuen Spieltag anlegen"}</span>
        </Button>
      </span>

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
