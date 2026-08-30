"use client";

import { useTransition } from "react";

import { reactivateSpielerAction } from "@/features/spieler/actions";
import { AdminSpielerEditForm } from "@/features/spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

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
  const [isWritingStatus, startWritingStatus] = useTransition();

  const isRetired = spieler.inactive_since !== null;
  const fullName = spieler.nachname === null ? spieler.vorname : `${spieler.vorname} ${spieler.nachname}`;

  const runStatusWrite = (
    write: () => Promise<{ success: boolean; message?: string; error?: string }>,
    failureHeading: string,
    savedDetail: string,
  ) => {
    startWritingStatus(async () => {
      const res = await write();
      // Named rather than left to „Gespeichert“: the page header is where the press was, and a bare
      // confirmation there says a write landed without saying which of the page's writes it was.
      if (res.success) appToast.success(res.message ?? "Gespeichert", { description: savedDetail });
      else appToast.danger(failureHeading, { description: res.error ?? UNKNOWN_REFUSAL });
    });
  };

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSpielerEditForm
        spieler={spieler}
        saison={saison}
        teams={teams}
        membershipCount={membershipCount}
        pageHeader={{
          title: fullName,
          // Retirement outranks the number: the number is a field of the form below, the day is nowhere else.
          chip: isRetired ? (
            <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Stillgelegt seit {formatSpielDatum(spieler.inactive_since)}</span>
          ) : saison.membership?.nummer ? (
            <span className="bg-muted text-foreground flex h-10 min-w-10 items-center justify-center rounded-xl px-2 font-extrabold shadow-sm">
              {saison.membership.nummer}
            </span>
          ) : undefined,
          reactivate: isRetired
            ? {
                isPending: isWritingStatus,
                onPress: () =>
                  runStatusWrite(
                    () => reactivateSpielerAction({ id: spieler.id }),
                    "Reaktivieren fehlgeschlagen",
                    "Der Spieler steht wieder zur Auswahl.",
                  ),
              }
            : undefined,
        }}
      />
    </div>
  );
}
