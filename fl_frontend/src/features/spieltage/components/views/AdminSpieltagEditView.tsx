"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { SaisonPhaseChip } from "@/features/spiele/components/ui/SaisonPhaseChip";
import { AdminSpieltagEditForm } from "@/features/spieltage/components/forms/AdminSpieltagEditForm/AdminSpieltagEditForm";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLSaisonPhaseSchedule } from "@/features/saisons/schemas";
import type { AdminSpieltagRow } from "@/features/spieltage/types";

/**
 * The whole body of `/admin/spieltage/[spieltag_id]` — which matchday this is, then the form that
 * edits it, in the match editor's shell: the header scrolls with the form's content, the action bar
 * stays pinned below it, and every exit routes through the form's own discard guard.
 *
 * **The header carries the STORED label, phase and span.** Every one of them is derived from fields
 * the form below is editing (ADR-0051), so a header following the draft would leave the page with no
 * fixed point to compare against — and the name in particular would appear to change under a picker
 * that had not been saved. The Geändert markers in the form report the difference instead.
 */
export function AdminSpieltagEditView({
  spieltag,
  saisonSpan,
  saisonSchedule,
  livePhaseCount,
}: {
  spieltag: AdminSpieltagRow;
  saisonSpan?: { start: string; end: string };
  saisonSchedule?: readonly FLSaisonPhaseSchedule[];
  /** Live matchdays the stored phase holds, this one included — half of `REQ-RETIRE-005`. */
  livePhaseCount: number;
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
        livePhaseCount={livePhaseCount}
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

                {spieltag.inactive_since !== null && (
                  <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>
                    Stillgelegt seit {formatSpielDatum(spieltag.inactive_since)}
                  </span>
                )}
              </div>
              <p className="fluid-sm text-foreground-muted font-medium">
                Saison {spieltag.saison_id} · {formatSpielDatum(spieltag.beginn)} bis {formatSpielDatum(spieltag.ende)}
              </p>
              <p className="fluid-sm text-foreground-muted font-medium">Änderungen gelten erst, wenn Du speicherst.</p>
            </header>
          </>
        }
      />
    </div>
  );
}
