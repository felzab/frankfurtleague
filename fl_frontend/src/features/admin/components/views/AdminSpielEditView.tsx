"use client";

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
  const { teams, spielorte, schiedsrichter, saisonSpiele } = useAdmin();

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
        pageHeader={{
          title: `Spiel ${String(spielData.spiel_nr)}`,
          chip: <SaisonPhaseChip saisonPhase={spielData.saison_phase} />,
        }}
      />
    </div>
  );
}
