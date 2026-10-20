"use client";

import { AdresswechselWartet } from "@/features/konto/components/forms/AdresswechselWartet";
import { einladeSpielerAdresswechselAction, verwirfSpielerAdresswechselAction } from "@/features/spieler/actions";

import type { FLSpielerAdresswechsel } from "@/features/spieler/schemas";

/** Shown only while a pupil's change is pending: the panel both editors share, over this lane's two writes. */
export function FormAdresswechselSection({
  spielerId,
  adresswechsel,
  istAbgelaufen,
  isDirty,
}: {
  spielerId: string;
  adresswechsel: FLSpielerAdresswechsel;
  istAbgelaufen: boolean;
  isDirty: boolean;
}) {
  return (
    <AdresswechselWartet
      adresswechsel={adresswechsel}
      istAbgelaufen={istAbgelaufen}
      isDirty={isDirty}
      einladen={() => einladeSpielerAdresswechselAction({ id: spielerId })}
      verwerfen={() => verwirfSpielerAdresswechselAction({ id: spielerId })}
    />
  );
}
