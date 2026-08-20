"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { SaisonPhaseChip } from "@/features/spiele/components/ui/SaisonPhaseChip";
import { AdminSpieltagEditForm } from "@/features/spieltage/components/forms/AdminSpieltagEditForm/AdminSpieltagEditForm";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSaisonPhaseSchedule } from "@/features/saisons/schemas";
import type { FLSpieltag } from "@/features/spieltage/schemas";
import type { AdminSpieltagRow } from "@/features/spieltage/types";

/**
 * The body of `/admin/spieltage/[spieltag_id]`. **The header carries the STORED label, phase and
 * span**: each is derived from a field the form is editing, so one following the draft would leave
 * the page with no fixed point.
 */
export function AdminSpieltagEditView({
  spieltag,
  saisonSpan,
  saisonSchedule,
  siblings,
}: {
  spieltag: AdminSpieltagRow;
  saisonSpan?: { start: string; end: string };
  saisonSchedule?: readonly FLSaisonPhaseSchedule[];
  /** Every matchday of the season, this one included; the position picker filters it by `id`. */
  siblings?: readonly FLSpieltag[];
}) {
  const router = useRouter();

  // The form's own guarded exit, registered from below — see `AdminSpielEditView`.
  const requestLeaveRef = useRef<() => void>(() => router.back());

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSpieltagEditForm
        spieltag={spieltag}
        saisonSpan={saisonSpan}
        saisonSchedule={saisonSchedule}
        siblings={siblings}
        registerRequestLeave={(requestLeave) => {
          requestLeaveRef.current = requestLeave;
        }}
        pageHeader={
          <>
            <Button
              onPress={() => requestLeaveRef.current()}
              className="bg-surface border-border text-foreground data-hovered:bg-hover fluid-xs mb-6 flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
              <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
              <span>Zurück</span>
            </Button>

            <header className="mb-6 flex w-full flex-col gap-y-2">
              <div className="flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-2">
                <h2 className="fluid-2xl text-foreground font-extrabold tracking-tight">{spieltag.label}</h2>
                <SaisonPhaseChip saisonPhase={spieltag.saison_phase} />
              </div>
              <p className="muted-hint">
                Saison {spieltag.saison_id} · {formatSpielDatum(spieltag.beginn)} – {formatSpielDatum(spieltag.ende)}
              </p>
              <p className="muted-hint">Änderungen gelten erst, wenn Du speicherst.</p>
            </header>
          </>
        }
      />
    </div>
  );
}
