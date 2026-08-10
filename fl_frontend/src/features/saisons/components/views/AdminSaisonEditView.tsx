"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { AdminSaisonEditForm } from "@/features/saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm";
import { PAGE_RISE } from "@/shared/components/ui/motion";

import type { FLSaisonStatus } from "@/features/saisons/schemas";
import type { SaisonDraftFields, SaisonRolloverContext } from "@/features/saisons/types";

/**
 * The whole body of `/admin/saisons/[saison_id]` — which season this is, then the form that edits it, in
 * the match editor's shell: the header scrolls with the form's content, the action bar stays pinned below
 * it, and every exit routes through the form's own discard guard.
 *
 * **The header carries no control.** On the club and player editors it owns the retirement, because a
 * person or a club can be retired; a season cannot be — one that is over is `past`, and the only thing
 * that writes `status` is the rollover, which is a whole panel rather than a button (ADR-0026). So the
 * header names the season, and every write on this page is below it.
 *
 * **The season's dates and its status are stated where they can be changed** — the Zeitraum panel's two
 * pickers and the Umstellung panel's badge. The header repeats neither: a value shown twice on one screen
 * is a value that can be read as two.
 */
export function AdminSaisonEditView({
  saison,
  rollover,
  spieltagBound,
}: {
  saison: { id: string; status: FLSaisonStatus } & SaisonDraftFields;
  rollover: SaisonRolloverContext;
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
        spieltagBound={spieltagBound}
        registerRequestLeave={(requestLeave) => {
          requestLeaveRef.current = requestLeave;
        }}
        pageHeader={
          <>
            <Button
              onPress={() => requestLeaveRef.current()}
              className="bg-surface border-border text-foreground hover:bg-muted fluid-xs mb-6 flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
              <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
              <span>Zurück</span>
            </Button>

            <header className="mb-6 flex w-full flex-col gap-y-2">
              <h2 className="fluid-2xl text-foreground font-extrabold tracking-tight">Saison {saison.id}</h2>
              <p className="fluid-sm text-foreground-muted font-medium">Änderungen gelten erst, wenn Du speicherst.</p>
            </header>
          </>
        }
      />
    </div>
  );
}
