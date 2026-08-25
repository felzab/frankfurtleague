"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { reactivateSpielerAction } from "@/features/spieler/actions";
import { AdminSpielerEditForm } from "@/features/spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import type { SpielerSaisonMembership, SpielerTeamOption } from "@/features/spieler/types";

/**
 * Every exit routes through the form's discard guard.
 *
 * **The header owns the PERSON's retirement, the form's foot the squad row's** — two controls that
 * read alike invite the wrong one. The erasure is neither, and sits below both.
 */
export function AdminSpielerEditView({
  spieler,
  saison,
  teams,
  membershipCount,
}: {
  spieler: { id: string; vorname: string; nachname: string | null; inactive_since: string | null };
  saison: SpielerSaisonMembership;
  /** The selected season's teams, for the picker and for reading a `team_id` as a name. */
  teams: SpielerTeamOption[];
  /** Squad rows across EVERY season, for the erasure panel — this page shows one season's. */
  membershipCount: number;
}) {
  const router = useRouter();
  const [isWritingStatus, startWritingStatus] = useTransition();

  const isRetired = spieler.inactive_since !== null;
  const rowInactiveSince = saison.membership?.inactive_since ?? null;
  const fullName = spieler.nachname === null ? spieler.vorname : `${spieler.vorname} ${spieler.nachname}`;

  // The form's own guarded exit, registered from below — see `AdminSpielEditView`.
  const requestLeaveRef = useRef<() => void>(() => router.back());

  const runStatusWrite = (write: () => Promise<{ success: boolean; message?: string; error?: string }>, failureHeading: string) => {
    startWritingStatus(async () => {
      const res = await write();
      if (res.success) appToast.success(res.message ?? "Gespeichert!");
      else appToast.danger(failureHeading, { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
    });
  };

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSpielerEditForm
        spieler={spieler}
        saison={saison}
        teams={teams}
        membershipCount={membershipCount}
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
                <h2 className="fluid-2xl text-foreground font-extrabold tracking-tight">{fullName}</h2>

                {saison.membership?.nummer ? (
                  <span className="bg-muted text-foreground flex h-10 min-w-10 shrink-0 items-center justify-center rounded-xl px-2 font-extrabold shadow-sm">
                    {saison.membership.nummer}
                  </span>
                ) : null}

                {isRetired && (
                  <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>
                    Stillgelegt seit {formatSpielDatum(spieler.inactive_since ?? "")}
                  </span>
                )}
                {isRetired && (
                  <Button
                    onPress={() => runStatusWrite(() => reactivateSpielerAction({ id: spieler.id }), "Reaktivieren fehlgeschlagen")}
                    isDisabled={isWritingStatus}
                    className="border-border bg-surface text-foreground data-hovered:bg-hover fluid-xs flex h-8 w-fit items-center rounded-lg border px-3 font-bold shadow-sm transition-colors">
                    {isWritingStatus ? "Speichert..." : "Spieler reaktivieren"}
                  </Button>
                )}

                {/* Here, though the control is at the form's foot: it changes what the page below means.
                    The TINT separates a season-scoped exit from the league-wide badge beside it,
                    `bg-warning` against `bg-muted`, so the season goes unnamed as on every admin list. */}
                {rowInactiveSince !== null && (
                  <span className={`${LABEL_BADGE} bg-warning/15 text-warning-strong`}>
                    Ausgetragen seit {formatSpielDatum(rowInactiveSince)}
                  </span>
                )}
              </div>
              <p className="muted-hint">Änderungen gelten erst, wenn Du speicherst.</p>
            </header>
          </>
        }
      />
    </div>
  );
}
