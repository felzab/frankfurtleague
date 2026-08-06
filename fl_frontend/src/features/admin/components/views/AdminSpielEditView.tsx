"use client";

import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { AdminEditSpielDataForm } from "@/features/spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm";
import { SaisonPhaseChip } from "@/features/spiele/components/ui/SaisonPhaseChip";
import { SpielStatusChip } from "@/features/spiele/components/ui/SpielStatusChip";
import { computeSpielStatus, formatQuelle, formatSpielDisplay } from "@/features/spiele/utils";
import { PLACEHOLDER } from "@/shared/utils/format";

import { useAdmin } from "../providers/AdminContextProvider";

import type { FLSpiel } from "@/features/spiele/schemas";

/**
 * The whole body of `/admin/spiele/[id]` — the fixture's identity, then the form that edits it.
 *
 * **In `admin` rather than in `spiele`, and it reads `useAdmin()` so the form never has to.** The four
 * lookup lists are the aggregator's to gather (ADR-0012); `AdminEditSpielDataForm` takes them as props
 * because a `spiele` component reading the admin context would make the write path depend on `admin`,
 * which is the direction ADR-0005 moved it out of. This view is the bridge, and it is the only consumer
 * of that context.
 *
 * **The header states what the fixture IS, and the form states what can change about it.** That split is
 * the point of a page over a dialog: a dialog had room for the controls and nothing else, so the fixture
 * being edited was identifiable only from the values inside the fields.
 */
export function AdminSpielEditView({ spielData, today }: { spielData: FLSpiel; today: string }) {
  const router = useRouter();
  const { teams, spielorte, schiedsrichter, saisonSpiele } = useAdmin();

  const { datum, uhrzeit, ergebnis, elfmeterschiessen } = formatSpielDisplay(spielData);
  const spielStatus = computeSpielStatus({ datum: spielData.datum, isCanceled: spielData.is_canceled, today });

  // Team, then provenance, then the shared placeholder — the same fall-through every card uses
  // (ADR-0041), so this header names a side exactly as the bracket does.
  const team1Name = spielData.team1?.name || formatQuelle(spielData.team1_quelle) || PLACEHOLDER.slot;
  const team2Name = spielData.team2?.name || formatQuelle(spielData.team2_quelle) || PLACEHOLDER.slot;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-y-5 px-4 py-5 sm:px-6 sm:py-6">
      <header className="flex w-full flex-col gap-y-4">
        {/* The app's back control, copied from `TeamSpielerView` and `TeamDetailsView` rather than
            re-invented: those two are also detail pages reached from several places, and they answer
            it with history rather than a named destination for exactly that reason. The earlier
            version here hardcoded "Zu den offenen Aufgaben", which is wrong from the Spielsuche, wrong
            from a bookmark, and wrong from anywhere FE-12 later links in from. */}
        <Button
          onPress={() => router.back()}
          className="bg-surface border-border text-foreground hover:bg-muted fluid-xs mb-6 flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
          <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
          <span>Zurück</span>
        </Button>

        <div className="flex w-full flex-col gap-y-3">
          <div className="flex w-full flex-row flex-wrap items-center gap-2">
            {/* `fluid-xl … tracking-tight` is the page title everywhere else in the app — the CRUD
                shell, the team selection view, both team detail views. This page had `fluid-lg`,
                which made its title smaller than every other page's and started the hierarchy a step
                too low. */}
            <h1 className="fluid-xl text-foreground mr-1 font-extrabold tracking-tight">Spiel {spielData.spiel_nr}</h1>
            <SpielStatusChip spielStatus={spielStatus} />
            <SaisonPhaseChip saisonPhase={spielData.saison_phase} />
          </div>

          {/* The same equal-track grid the cards use, so the score stays centred however the two names
              differ in length. It reads the STORED fixture, not the draft — the form carries its own
              live readout, and a header that moved while somebody typed would be two answers on one
              screen to the question of what is recorded. */}
          <div className="bg-muted grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center rounded-xl p-3">
            <span className="fluid-sm sm:fluid-base text-foreground min-w-0 truncate text-right font-bold">{team1Name}</span>
            <span
              className={`fluid-base flex w-fit flex-col items-center px-3 text-center font-extrabold sm:px-4 ${
                spielData.ergebnis !== null ? "text-success-strong" : "text-danger-strong"
              }`}>
              {ergebnis}
              {elfmeterschiessen !== null && <span className="fluid-xxs font-semibold whitespace-nowrap">{elfmeterschiessen}</span>}
            </span>
            <span className="fluid-sm sm:fluid-base text-foreground min-w-0 truncate text-left font-bold">{team2Name}</span>
          </div>

          <p className="fluid-xs text-foreground-muted font-medium">
            {datum} · {uhrzeit} · {spielData.ort?.name ?? PLACEHOLDER.entity}
          </p>
        </div>
      </header>

      <AdminEditSpielDataForm
        spielData={spielData}
        teams={teams}
        spielorte={spielorte}
        schiedsrichter={schiedsrichter}
        saisonSpiele={saisonSpiele}
      />
    </div>
  );
}
