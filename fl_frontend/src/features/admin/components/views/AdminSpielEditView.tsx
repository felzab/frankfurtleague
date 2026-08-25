"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { AdminEditSpielDataForm } from "@/features/spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm";
import { SaisonPhaseChip } from "@/features/spiele/components/ui/SaisonPhaseChip";
import { PAGE_RISE } from "@/shared/components/ui/motion";

import { categorizeActionRequired } from "../../utils";
import { useAdmin } from "../providers/AdminContextProvider";

import type { FLSpielAdmin, FLSpielWithDraftFields } from "@/features/spiele/schemas";
import type { ActionRequiredCategory } from "@/features/spiele/types";

/**
 * The bridge for the match editor: it reads `useAdmin()` so `AdminEditSpielDataForm` never has to and
 * takes the lookup lists as props (frontend spec I12). It runs `categorizeActionRequired` over the one
 * fixture, so that rule has a single copy.
 */
export function AdminSpielEditView({ spielData, today }: { spielData: FLSpielAdmin; today: string }) {
  const router = useRouter();
  const { teams, spielorte, schiedsrichter, saisonSpiele } = useAdmin();

  /**
   * The form's guarded exit, registered from below so the header pill and Abbrechen are one route: a
   * direct `router.back()` on the pill skips the discard guard. The initial value covers the render
   * before the form registers.
   */
  const requestLeaveRef = useRef<() => void>(() => router.back());

  /**
   * A function and not a set, because the answer moves with the draft: toggling Absage empties "Offene
   * Angaben" at once. `bracketFaults` is not passed — a fault is a backend derivation over a whole
   * season and this route reads one match.
   */
  const categorize = (spiel: FLSpielWithDraftFields): ReadonlySet<ActionRequiredCategory> =>
    new Set(
      Object.entries(categorizeActionRequired([spiel], today))
        .filter(([, matches]) => matches.length > 0)
        .map(([category]) => category as ActionRequiredCategory),
    );

  return (
    // No padding of its own: the form inside is the page's shell, scrolling its own header and panels
    // while the action bar stays pinned outside the scroll content.
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminEditSpielDataForm
        spielData={spielData}
        teams={teams}
        spielorte={spielorte}
        schiedsrichter={schiedsrichter}
        saisonSpiele={saisonSpiele}
        today={today}
        categorize={categorize}
        registerRequestLeave={(requestLeave) => {
          requestLeaveRef.current = requestLeave;
        }}
        pageHeader={
          <>
            {/* Not shared with the other back buttons: this one goes through the discard guard. */}
            <Button
              onPress={() => requestLeaveRef.current()}
              className="bg-surface border-border text-foreground data-hovered:bg-hover fluid-xs mb-6 flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
              <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
              <span>Zurück</span>
            </Button>

            <header className="mb-6 flex w-full flex-col gap-y-2">
              <div className="flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-2">
                {/* One step above the other pages' `fluid-xl`: here the title has to outrank the
                    panel titles below it and a rail of them. */}
                <h2 className="fluid-2xl text-foreground font-extrabold tracking-tight">Spiel {spielData.spiel_nr}</h2>
                <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
              </div>
              <p className="muted-hint">Änderungen gelten erst, wenn Du speicherst.</p>
            </header>
          </>
        }
      />
    </div>
  );
}
