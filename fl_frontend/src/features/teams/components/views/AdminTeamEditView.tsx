"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { reactivateTeamAction } from "@/features/teams/actions";
import { AdminTeamEditForm } from "@/features/teams/components/forms/AdminTeamEditForm/AdminTeamEditForm";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import type { SaisonGruppenSwapContext } from "@/features/saisons/types";
import type { FLTeamRecord } from "@/features/teams/schemas";
import type { GruppeOffer, TeamSaisonMembership } from "@/features/teams/types";

/**
 * The whole body of `/admin/teams/[team_id]` — who the club is, then the form that edits it, in the
 * match editor's shell: the header scrolls with the form's content, the action bar stays pinned
 * below it, and every exit routes through the form's own discard guard.
 *
 * **The header states identity and nothing live** — the shorthand chip wears the TeamCard's brand
 * tint, so the same two letters look the same on the admin surface and the public one. The one
 * header-level control is reactivation, because a retired club's state is club-level rather than a
 * field of the form.
 */
export function AdminTeamEditView({
  team,
  saison,
  gruppeLocked,
  gruppeOffer,
  swap,
  today,
}: {
  team: FLTeamRecord;
  saison: TeamSaisonMembership;
  gruppeLocked: boolean;
  /** The selected season's groups with their fill state, from `buildGruppeOffer`. */
  gruppeOffer: readonly GruppeOffer[];
  /** The selected season's swap state, for the club editor's entry point into it (ADR-0071). */
  swap: SaisonGruppenSwapContext;
  today: string;
}) {
  const router = useRouter();
  const [isReactivating, startReactivating] = useTransition();

  const isRetired = team.inactive_since !== null;

  // The form's own guarded exit, registered from below — see `AdminSpielEditView`.
  const requestLeaveRef = useRef<() => void>(() => router.back());

  const handleReactivate = () => {
    startReactivating(async () => {
      const res = await reactivateTeamAction({ id: team.id });
      if (res.success) appToast.success(res.message ?? "Team reaktiviert!");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error });
    });
  };

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminTeamEditForm
        team={team}
        saison={saison}
        today={today}
        gruppeLocked={gruppeLocked}
        gruppeOffer={gruppeOffer}
        swap={swap}
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
                <h2 className="fluid-2xl text-foreground font-extrabold tracking-tight">{team.name}</h2>
                {/* The TeamCard's chip, so the Kürzel wears one colour everywhere (decided 2026-08-07). */}
                <span className="bg-brand/50 text-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-extrabold shadow-sm">
                  {team.shorthand}
                </span>
                {isRetired && (
                  <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>
                    Stillgelegt seit {formatSpielDatum(team.inactive_since ?? "")}
                  </span>
                )}
                {isRetired && (
                  <Button
                    onPress={handleReactivate}
                    isDisabled={isReactivating}
                    className="border-border bg-surface text-foreground data-hovered:bg-hover fluid-xs flex h-8 w-fit items-center rounded-lg border px-3 font-bold shadow-sm transition-colors">
                    {isReactivating ? "Reaktiviert..." : "Reaktivieren"}
                  </Button>
                )}
              </div>
              <p className="fluid-sm text-foreground-muted font-medium">Änderungen gelten erst, wenn Du speicherst.</p>
            </header>
          </>
        }
      />
    </div>
  );
}
