"use client";

import { SaisonPhaseChip } from "@/features/spiele/components/ui/SaisonPhaseChip";
import { AdminSpieltagEditForm } from "@/features/spieltage/components/forms/AdminSpieltagEditForm/AdminSpieltagEditForm";
import { PAGE_RISE } from "@/shared/components/ui/motion";

import type { AdminSpieltagEditRow } from "@/features/spieltage/types";

/** The body of `/admin/spieltage/[spieltag_id]`. */
export function AdminSpieltagEditView({
  spieltag,
  saisonSpan,
}: {
  spieltag: AdminSpieltagEditRow;
  saisonSpan?: { start: string; end: string };
}) {
  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSpieltagEditForm
        spieltag={spieltag}
        saisonSpan={saisonSpan}
        // The phase is on no field of this form, so the chip is the only place the page states it.
        pageHeader={{ title: spieltag.label, chip: <SaisonPhaseChip saisonPhase={spieltag.saison_phase} /> }}
      />
    </div>
  );
}
