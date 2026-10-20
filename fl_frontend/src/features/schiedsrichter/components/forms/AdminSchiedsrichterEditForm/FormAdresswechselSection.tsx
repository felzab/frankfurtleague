"use client";

import { AdresswechselWartet } from "@/features/konto/components/forms/AdresswechselWartet";
import { einladeAdresswechselAction, verwirfAdresswechselAction } from "@/features/schiedsrichter/actions";
import { benannt } from "@/shared/utils/benannt";

import type { FLSchiedsrichterAdresswechsel } from "@/features/schiedsrichter/schemas";

/**
 * The re-send's accessible name, its link named as the contacts editor names each seat's: the consent
 * panel on the same page holds a „Link erneut senden“ of its own, for another link.
 */
export const ADRESSWECHSEL_ERNEUT_NAME = benannt("Link erneut senden", "Neue E-Mail-Adresse");

/** Shown only while a confirmed referee's change is pending: the panel both editors share, over this lane's two writes. */
export function FormAdresswechselSection({
  schiedsrichterId,
  adresswechsel,
  istAbgelaufen,
  isDirty,
}: {
  schiedsrichterId: string;
  adresswechsel: FLSchiedsrichterAdresswechsel;
  istAbgelaufen: boolean;
  isDirty: boolean;
}) {
  return (
    <AdresswechselWartet
      adresswechsel={adresswechsel}
      istAbgelaufen={istAbgelaufen}
      isDirty={isDirty}
      erneutName={ADRESSWECHSEL_ERNEUT_NAME}
      einladen={() => einladeAdresswechselAction({ id: schiedsrichterId })}
      verwerfen={() => verwirfAdresswechselAction({ id: schiedsrichterId })}
    />
  );
}
