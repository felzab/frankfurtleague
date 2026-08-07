"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";

import { ArrowUturnCwLeft } from "@gravity-ui/icons";

import { Button } from "@heroui/react";

import { deleteSaisonSpielerAction, reactivateSaisonSpielerAction, reactivateSpielerAction } from "@/features/spieler/actions";
import { AdminSpielerEditForm } from "@/features/spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import type { SpielerSaisonMembership, SpielerTeamOption } from "@/features/spieler/types";

/**
 * The whole body of `/admin/spieler/[spieler_id]` — who the player is, then the form that edits
 * them, in the match editor's shell: the header scrolls with the form's content, the action bar
 * stays pinned below it, and every exit routes through the form's own discard guard.
 *
 * **The header owns both retirements, and they are different facts** (ADR-0032). Retiring the PERSON
 * takes them out of the league and leaves every squad row standing; retiring the SQUAD ROW takes
 * them out of one season's squad and says nothing about whether they still play. Both are controls
 * rather than fields: each writes immediately through its own endpoint and neither joins the save
 * bar, because neither is a draft the admin builds up and then commits.
 */
export function AdminSpielerEditView({
  spieler,
  saison,
  teams,
}: {
  spieler: { id: string; vorname: string; nachname: string | null; inactive_since: string | null };
  saison: SpielerSaisonMembership;
  /** The selected season's teams, for the picker and for reading a `team_id` as a name. */
  teams: SpielerTeamOption[];
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
      else appToast.danger(failureHeading, { description: res.error });
    });
  };

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSpielerEditForm
        spieler={spieler}
        saison={saison}
        teams={teams}
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
                    className="border-border bg-surface text-foreground hover:bg-muted fluid-xs flex h-8 w-fit items-center rounded-lg border px-3 font-bold shadow-sm transition-colors">
                    {isWritingStatus ? "Speichert..." : "Spieler reaktivieren"}
                  </Button>
                )}

                {/* The squad row's own pair, shown only while a row for this season exists at all. */}
                {saison.membership !== null &&
                  (rowInactiveSince !== null ? (
                    <Button
                      onPress={() =>
                        runStatusWrite(
                          () => reactivateSaisonSpielerAction({ spieler_id: spieler.id, saison_id: saison.saisonId }),
                          "Reaktivieren fehlgeschlagen",
                        )
                      }
                      isDisabled={isWritingStatus}
                      className="border-border bg-surface text-foreground hover:bg-muted fluid-xs flex h-8 w-fit items-center rounded-lg border px-3 font-bold shadow-sm transition-colors">
                      {isWritingStatus ? "Speichert..." : "Kadereintrag reaktivieren"}
                    </Button>
                  ) : (
                    <Button
                      onPress={() =>
                        runStatusWrite(
                          () => deleteSaisonSpielerAction({ spieler_id: spieler.id, saison_id: saison.saisonId }),
                          "Austragen fehlgeschlagen",
                        )
                      }
                      isDisabled={isWritingStatus}
                      className="border-border bg-surface text-foreground-muted hover:bg-muted hover:text-danger-strong fluid-xs flex h-8 w-fit items-center rounded-lg border px-3 font-bold shadow-sm transition-colors">
                      {isWritingStatus ? "Speichert..." : `Aus Kader ${saison.saisonId} austragen`}
                    </Button>
                  ))}
              </div>
              <p className="fluid-sm text-foreground-muted font-medium">Änderungen gelten erst, wenn Du speicherst.</p>
            </header>
          </>
        }
      />
    </div>
  );
}
