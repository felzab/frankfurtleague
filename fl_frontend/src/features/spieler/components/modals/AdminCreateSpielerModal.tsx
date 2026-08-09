"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { AdminCreateSpielerForm } from "@/features/spieler/components/forms/AdminCreateSpielerForm";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

import type { SpielerCreateSaisonOption } from "@/features/spieler/types";

/**
 * Takes its data as props rather than fetching: the trigger renders above the page's data boundary,
 * and the route wraps this modal in its own `Suspense` so the fetch never blocks the shell.
 *
 * `saisonOptions` holds the RUNNING and PLANNED seasons (decided 2026-08-07), unlike the club create
 * which offers planned ones only: a squad is filled in during its season, so adding a player to a
 * season already under way is the ordinary case. A season with no teams entered yet is still offered
 * — the form's team picker is then empty, which is the honest state and points at the club list.
 */
export function AdminCreateSpielerModal({
  saisonOptions,
  defaultSaisonId,
}: {
  saisonOptions: SpielerCreateSaisonOption[];
  /** The season preselected in the form — the viewed one when it is running or planned, else the first. */
  defaultSaisonId: string | null;
}) {
  const modalState = useOverlayState();

  return (
    <>
      <Button
        onPress={modalState.open}
        className={formButton({ intent: "trigger" })}>
        <Plus
          width={18}
          height={18}
        />
        {/* Below `sm` the trigger is the bare plus continuing the search bar (decided 2026-08-07). */}
        <span className="hidden sm:inline">Neuen Spieler anlegen</span>
      </Button>

      <FormModal
        isOpen={modalState.isOpen}
        onClose={modalState.close}
        heading="Spieler anlegen">
        {saisonOptions.length > 0 && defaultSaisonId !== null ? (
          <AdminCreateSpielerForm
            saisonOptions={saisonOptions}
            defaultSaisonId={defaultSaisonId}
            onClose={modalState.close}
          />
        ) : (
          <Callout
            severity="info"
            title="Keine laufende oder geplante Saison">
            Ein Spieler wird beim Anlegen direkt in einen Kader aufgenommen, und dafür braucht es eine laufende oder geplante Saison. Derzeit
            ist keine angelegt.
          </Callout>
        )}
      </FormModal>
    </>
  );
}
