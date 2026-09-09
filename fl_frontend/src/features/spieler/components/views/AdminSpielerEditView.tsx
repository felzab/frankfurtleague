"use client";

import { useTransition } from "react";

import { reactivateSpielerAction } from "@/features/spieler/actions";
import { AdminSpielerEditForm } from "@/features/spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm";
import { PAGE_RISE } from "@/shared/components/ui/motion";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
import { appToast } from "@/shared/utils/appToast";

import type { FLEinwilligung } from "@/features/spieler/schemas";
import type { SpielerSaisonMembership, SpielerTeamOption } from "@/features/spieler/types";
import type { ActionResult } from "@/shared/types/types";

/**
 * Every exit routes through the form's discard guard.
 *
 * **The header owns the PERSON's retirement, the form's foot the squad row's** — two controls that
 * read alike invite the wrong one. The erasure is neither, and sits below both.
 */
export function AdminSpielerEditView({
  spieler,
  einwilligung,
  saison,
  teams,
  membershipCount,
}: {
  spieler: { id: string; vorname: string; nachname: string | null; inactive_since: string | null; geburtsdatum: string | null };
  einwilligung: FLEinwilligung | null;
  saison: SpielerSaisonMembership;
  /** The selected season's teams, for the picker and for reading a `team_id` as a name. */
  teams: SpielerTeamOption[];
  /** Squad rows across EVERY season, for the erasure panel — this page shows one season's. */
  membershipCount: number;
}) {
  const [isWritingStatus, startWritingStatus] = useTransition();

  const isRetired = spieler.inactive_since !== null;
  const fullName = spieler.nachname === null ? spieler.vorname : `${spieler.vorname} ${spieler.nachname}`;

  const runStatusWrite = (write: () => Promise<ActionResult>, failureHeading: string, savedDetail: string) => {
    startWritingStatus(async () => {
      const res = await write();
      // The detail rides along because the page header holds several writes: the shared title says a
      // write landed without saying which of them the press was (`docs/frontend/spec.md :: I42`).
      if (res.success) appToast.success("Gespeichert", { description: savedDetail });
      else appToast.danger(failureHeading, { description: res.error });
    });
  };

  return (
    <div className={`${PAGE_RISE} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSpielerEditForm
        spieler={spieler}
        einwilligung={einwilligung}
        saison={saison}
        teams={teams}
        membershipCount={membershipCount}
        pageHeader={{
          title: fullName,
          // Retirement outranks the number: the number is a field of the form below, the day is nowhere else.
          chip: isRetired ? (
            <RetiredBadge since={spieler.inactive_since} />
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
