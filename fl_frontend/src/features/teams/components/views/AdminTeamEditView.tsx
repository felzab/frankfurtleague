"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { reactivateTeamAction } from "@/features/teams/actions";
import { SaisonMembershipPanel } from "@/features/teams/components/forms/SaisonMembershipPanel";
import { TeamStammdatenPanel } from "@/features/teams/components/forms/TeamStammdatenPanel";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import type { FLTeam } from "@/features/teams/schemas";
import type { TeamSaisonMembership } from "@/features/teams/types";

/**
 * The whole body of `/admin/teams/[team_id]` — who the club is, then the two panels that edit it.
 *
 * A page rather than a dialog (ADR-0050): the club form is ten fields plus a structured address,
 * and the season junction beneath it is a second endpoint with its own save. Sections sit in
 * panels, which is the page form's first level of grouping.
 *
 * **The header states identity and nothing live** — the same rule as the match editor. The back
 * control answers with history, like every detail page reached from several places.
 */
export function AdminTeamEditView({ team, memberships, today }: { team: FLTeam; memberships: TeamSaisonMembership[]; today: string }) {
  const router = useRouter();
  const [isReactivating, startReactivating] = useTransition();

  const isRetired = team.inactive_since !== null;

  const handleReactivate = () => {
    startReactivating(async () => {
      const res = await reactivateTeamAction({ id: team.id });
      if (res.success) appToast.success(res.message ?? "Verein reaktiviert!");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error });
    });
  };

  return (
    <div className={`${PAGE_RISE} max-w-page mx-auto flex w-full flex-col gap-y-6 p-6 sm:p-8`}>
      <div>
        <Button
          onPress={() => router.back()}
          className="bg-surface border-border text-foreground hover:bg-muted fluid-xs mb-6 flex h-10 w-fit items-center gap-x-2 rounded-xl border px-4 font-bold shadow-sm transition-colors">
          <ArrowUturnCwLeft className="h-4 w-4 shrink-0" />
          <span>Zurück</span>
        </Button>

        <header className="flex w-full flex-col gap-y-1">
          <div className="flex w-full flex-row flex-wrap items-center gap-x-3 gap-y-2">
            <h2 className="fluid-2xl text-foreground font-extrabold tracking-tight">{team.name}</h2>
            <span className="bg-muted text-foreground fluid-xs inline-flex items-center rounded-md px-3 py-1.5 font-bold tracking-wide">
              {team.shorthand}
            </span>
            {isRetired && <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Stillgelegt</span>}
          </div>
          <p className="fluid-sm text-foreground-muted font-medium">Änderungen gelten erst, wenn Du speicherst — jeder Bereich für sich.</p>
        </header>
      </div>

      {isRetired && (
        <div className="flex w-full flex-col gap-y-3">
          <Callout
            severity="info"
            title={`Stillgelegt seit ${formatSpielDatum(team.inactive_since ?? "")}`}>
            Der Verein steht in keiner Auswahlliste mehr, sein Kürzel bleibt reserviert, und seine Spiele und Saisons bleiben erhalten.
          </Callout>
          <Button
            onPress={handleReactivate}
            isDisabled={isReactivating}
            className={`${formButton({ intent: "submit" })} w-fit`}>
            {isReactivating ? "Reaktiviert..." : "Verein reaktivieren"}
          </Button>
        </div>
      )}

      <TeamStammdatenPanel team={team} />

      <SaisonMembershipPanel
        teamId={team.id}
        memberships={memberships}
        today={today}
      />
    </div>
  );
}
