"use client";

import { AdminSpielerEditForm } from "@/features/spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm";
import { kaderName } from "@/features/spieler/constants";
import { PAGE_RISE_CLASSES } from "@/shared/components/ui/motion";

import type { FLEinwilligung } from "@/core/generated/client/types";
import type { AdminSpielerStored, SpielerSaisonMembership, SpielerTeamOption } from "@/features/spieler/types";

/** Every exit routes through the form's discard guard. */
export function AdminSpielerEditView({
  spieler,
  einwilligung,
  saison,
  teams,
}: {
  spieler: AdminSpielerStored;
  einwilligung: FLEinwilligung;
  saison: SpielerSaisonMembership;
  /** The selected season's teams, for the roles they hold and whether a retired row can return. */
  teams: SpielerTeamOption[];
}) {
  const fullName = kaderName(spieler);

  return (
    <div className={`${PAGE_RISE_CLASSES} flex min-h-0 w-full flex-1 flex-col`}>
      <AdminSpielerEditForm
        spieler={spieler}
        einwilligung={einwilligung}
        saison={saison}
        teams={teams}
        pageHeader={{
          title: fullName,
          chip: saison.membership?.nummer ? (
            <span className="flex h-10 min-w-10 items-center justify-center rounded-xl bg-muted px-2 font-extrabold text-foreground shadow-sm">
              {saison.membership.nummer}
            </span>
          ) : undefined,
        }}
      />
    </div>
  );
}
