"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { AdminSaisonEditForm } from "@/features/saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm";
import { PAGE_RISE } from "@/shared/components/ui/motion";

import type { FLSaisonStatus } from "@/features/saisons/schemas";
import type { SaisonDraftFields, SaisonGruppenSwapContext, SaisonRolloverContext } from "@/features/saisons/types";

/**
 * The body of `/admin/saisons/[saison_id]`. **The header carries no control and states no value**: a
 * season cannot be retired, and the dates and status are shown where they can be changed.
 */
export function AdminSaisonEditView({
  saison,
  rollover,
  swap,
  spieltagBound,
}: {
  saison: { id: string; status: FLSaisonStatus } & SaisonDraftFields;
  rollover: SaisonRolloverContext;
  /** This season's clubs and their groups, plus the knockout count that closes the swap. */
  swap: SaisonGruppenSwapContext;
  /** The span the live matchdays already occupy, which the date pickers may not shrink past. */
  spieltagBound?: { startMax: string; endMin: string };
}) {
  const router = useRouter();

  // The form's own guarded exit, registered from below — see `AdminSpielEditView`.
  const requestLeaveRef = useRef<() => void>(() => router.back());

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSaisonEditForm
        saison={saison}
        rollover={rollover}
        swap={swap}
        spieltagBound={spieltagBound}
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
              {/* The title row every editor's header opens with, kept even where this page has nothing
                  to set beside the name — a chip added later lands where the other six put theirs. */}
              <div className="flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-2">
                <h2 className="fluid-2xl text-foreground font-extrabold tracking-tight">Saison {saison.id}</h2>
              </div>
              <p className="fluid-sm text-foreground-muted font-medium">Änderungen gelten erst, wenn Du speicherst.</p>
            </header>
          </>
        }
      />
    </div>
  );
}
