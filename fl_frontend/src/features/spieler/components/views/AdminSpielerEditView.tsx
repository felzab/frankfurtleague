"use client";

import { reactivateSpielerAction } from "@/features/spieler/actions";
import { AdminSpielerEditForm } from "@/features/spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm";
import { kaderName } from "@/features/spieler/constants";
import { PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
/**
 * Every exit routes through the form's discard guard.
 *
 * **The header owns the PERSON's retirement, the form's foot the squad row's** — two controls that
 * read alike invite the wrong one.
 */
import { useReactivation } from "@/shared/hooks/useReactivation";

import type { FLEinwilligung } from "@/features/spieler/schemas";
import type { AdminSpielerStored, SpielerSaisonMembership, SpielerTeamOption } from "@/features/spieler/types";

export function AdminSpielerEditView({
  spieler,
  einwilligung,
  istFassungBekannt,
  saison,
  teams,
}: {
  spieler: AdminSpielerStored;
  einwilligung: FLEinwilligung | null;
  /** Whether the registry holds the stored label. */
  istFassungBekannt: boolean | null;
  saison: SpielerSaisonMembership;
  /** The selected season's teams, for the picker and for reading a `team_id` as a name. */
  teams: SpielerTeamOption[];
}) {
  const { isReactivating, reactivate } = useReactivation({ action: reactivateSpielerAction, noun: "Spieler" });

  const isRetired = spieler.inactive_since !== null;
  const fullName = kaderName(spieler);

  return (
    <div className={`${PAGE_RISE_CLASSES} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSpielerEditForm
        // The player and the stored address the box's typing is measured against, never the whole record: a save moves
        // the record, and keyed by it the typing and the save's pending exit would go with the refresh.
        key={JSON.stringify({ id: spieler.id, email: spieler.email })}
        spieler={spieler}
        einwilligung={einwilligung}
        istFassungBekannt={istFassungBekannt}
        saison={saison}
        teams={teams}
        pageHeader={{
          title: fullName,
          // Retirement outranks the number: the number is a field of the form below, the day is nowhere else.
          chip: isRetired ? (
            <RetiredBadge since={spieler.inactive_since} />
          ) : saison.membership?.nummer ? (
            <span className="flex h-10 min-w-10 items-center justify-center rounded-xl bg-muted px-2 font-extrabold text-foreground shadow-sm">
              {saison.membership.nummer}
            </span>
          ) : undefined,
          reactivate: isRetired ? { isPending: isReactivating, onPress: () => reactivate({ id: spieler.id }) } : undefined,
        }}
      />
    </div>
  );
}
