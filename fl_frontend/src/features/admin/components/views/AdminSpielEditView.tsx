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

import type { FLSpiel, FLSpielWithStoredSides } from "@/features/spiele/schemas";
import type { ActionRequiredCategory } from "@/features/spiele/types";

/**
 * The whole body of `/admin/spiele/[spiel_id]` — what the fixture is, then the form that edits it.
 *
 * **In `admin` rather than in `spiele`, and it reads `useAdmin()` so the form never has to.** The four
 * lookup lists are the aggregator's to gather (ADR-0008); `AdminEditSpielDataForm` takes them as props
 * because a `spiele` component reading the admin context would make the write path depend on `admin`,
 * which is the direction ADR-0004 moved it out of. This view is the bridge, and it is the only consumer
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

  /**
   * The form's own guarded exit, registered from below so the header pill and Abbrechen are one
   * route. Before this, the pill called `router.back()` directly — the control that exists BECAUSE it
   * can be guarded (see the settled note on keeping it) was the one exit that skipped the guard, and
   * unsaved work left without a word. The initial value covers the render before the form registers,
   * during which the draft cannot be dirty yet.
   */
  const requestLeaveRef = useRef<() => void>(() => router.back());

  /**
   * The season-wide rule, applied to one fixture and handed to the form as a function.
   *
   * A function rather than a set, because the answer has to move with the draft: toggling Absage makes
   * `categorizeActionRequired` report the fixture as cancelled and stop reporting it under any of the
   * four "fehlt" categories, so "Offene Angaben" empties in real time instead of at the next load.
   *
   * `bracketFaults` is deliberately not passed: a fault is a backend derivation over a whole season
   * (ADR-0039) and this route reads one match, so re-deriving it here would be a second copy of a rule
   * that exists to have only one.
   */
  const categorize = (spiel: FLSpielWithStoredSides): ReadonlySet<ActionRequiredCategory> =>
    new Set(
      Object.entries(categorizeActionRequired([spiel], today))
        .filter(([, matches]) => matches.length > 0)
        .map(([category]) => category as ActionRequiredCategory),
    );

  return (
    // Fills `main` exactly and owns no padding: the form inside is the page's shell — an inner
    // container scrolls the header and panels, and the action bar stays pinned below it, outside the
    // scroll content.
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
            {/* The app's back control, copied from `TeamSpielerView` and `TeamDetailsBackButton`
                rather than re-invented: those two are also detail pages reached from several places,
                and they answer it with history rather than a named destination for that reason.
                This one goes through the discard guard instead, which is why it is not shared. */}
            <Button
              onPress={() => requestLeaveRef.current()}
              className="bg-surface border-border text-foreground hover:bg-muted fluid-xs mb-6 flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
              <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
              <span>Zurück</span>
            </Button>

            <header className="mb-6 flex w-full flex-col gap-y-1">
              <div className="flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-2">
                {/* `fluid-2xl`, one step above the `fluid-xl` the other pages use, and deliberately
                    so: on those pages the title tops a single card or grid, while here it has to
                    outrank four `fluid-base` panel titles and a rail of them — at `fluid-xl` it
                    differed from a panel title in nothing but a few pixels of size. */}
                <h2 className="fluid-2xl text-foreground font-extrabold tracking-tight">Spiel {spielData.spiel_nr}</h2>
                <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
              </div>
              {/* One sentence. The second ("the preview shows…") explained a card that explains itself. */}
              <p className="fluid-sm text-foreground-muted font-medium">Änderungen gelten erst, wenn Du speicherst.</p>
            </header>
          </>
        }
      />
    </div>
  );
}
