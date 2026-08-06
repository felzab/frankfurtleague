"use client";

import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { AdminEditSpielDataForm } from "@/features/spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm";
import { SaisonPhaseChip } from "@/features/spiele/components/ui/SaisonPhaseChip";
import { PAGE_RISE } from "@/shared/components/ui/motion";

import { categorizeActionRequired } from "../../utils";
import { useAdmin } from "../providers/AdminContextProvider";

import type { FLSpiel } from "@/features/spiele/schemas";
import type { ActionRequiredCategory } from "@/features/spiele/types";

/**
 * The whole body of `/admin/spiele/[spiel_id]` — what the fixture is, then the form that edits it.
 *
 * **In `admin` rather than in `spiele`, and it reads `useAdmin()` so the form never has to.** The four
 * lookup lists are the aggregator's to gather (ADR-0012); `AdminEditSpielDataForm` takes them as props
 * because a `spiele` component reading the admin context would make the write path depend on `admin`,
 * which is the direction ADR-0005 moved it out of. This view is the bridge, and it is the only consumer
 * of that context.
 *
 * **It also computes which action-required categories this fixture falls into**, by calling the same
 * `categorizeActionRequired` the triage list uses over a single-element array. That keeps one copy of the
 * rule and is the reason the form can mark a field as expected without `spiele` importing `admin`.
 *
 * **The header states identity and nothing live.** Everything that changes as the admin types is in the
 * form's own preview rail — one live readout on the page, rather than a second one up here disagreeing
 * with it.
 */
export function AdminSpielEditView({ spielData, today }: { spielData: FLSpiel; today: string }) {
  const router = useRouter();
  const { teams, spielorte, schiedsrichter, saisonSpiele } = useAdmin();

  // One fixture through the season-wide rule. `bracketFaults` is deliberately not passed: a fault is a
  // backend derivation over a whole season (ADR-0047) and this route reads one match, so re-deriving it
  // here would be a second copy of a rule that exists to have only one.
  const expectedCategories: ReadonlySet<ActionRequiredCategory> = new Set(
    Object.entries(categorizeActionRequired([spielData], today))
      .filter(([, matches]) => matches.length > 0)
      .map(([category]) => category as ActionRequiredCategory),
  );

  return (
    <div className={`${PAGE_RISE} relative flex w-full flex-1 flex-col items-center px-4 pt-6 pb-12 sm:px-8`}>
      <div className="max-w-toolbar flex w-full flex-col">
        {/* The app's back control, copied from `TeamSpielerView` and `TeamDetailsView` rather than
            re-invented: those two are also detail pages reached from several places, and they answer it
            with history rather than a named destination for exactly that reason. This page previously
            hardcoded "Zu den offenen Aufgaben", which is wrong from the Spielsuche, wrong from a
            bookmark, and wrong from anywhere FE-12 later links in from. */}
        <Button
          onPress={() => router.back()}
          className="bg-surface border-border text-foreground hover:bg-muted fluid-xs mb-6 flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
          <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
          <span>Zurück</span>
        </Button>

        <header className="mb-6 flex w-full flex-col gap-y-1">
          <div className="flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-2">
            {/* `fluid-xl … tracking-tight` is the page title everywhere else in the app — the CRUD
                shell, the team selection view, both team detail views. */}
            <h1 className="fluid-xl text-foreground font-extrabold tracking-tight">Spiel {spielData.spiel_nr}</h1>
            <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
          </div>
          <p className="fluid-sm text-foreground-muted font-medium">
            Änderungen gelten erst, wenn Du speicherst. Die Vorschau zeigt, wie das Spiel danach erscheint.
          </p>
        </header>

        <AdminEditSpielDataForm
          spielData={spielData}
          teams={teams}
          spielorte={spielorte}
          schiedsrichter={schiedsrichter}
          saisonSpiele={saisonSpiele}
          today={today}
          expectedCategories={expectedCategories}
        />
      </div>
    </div>
  );
}
