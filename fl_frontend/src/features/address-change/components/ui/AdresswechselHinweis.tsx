"use client";

import Link from "next/link";

import { EINSEHBAR_VERWEHRT } from "@/features/address-change/einsehbar";
import { textLink } from "@/shared/components/ui/textLink";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";

import type { FLAddressChangeViewableDenied } from "@/core/generated/client/types";

const ZUR_AENDERUNG = "Zur Änderung";

/** The one line every editor shows under an address a change is pending at, one change for every record it holds. */
function AdresswechselOffen({
  adresswechselId,
  adresse,
  denied,
}: {
  adresswechselId: string;
  /**
   * The stored address the change is at, named where the box above it takes input: „diese Adresse“ would then point at
   * whatever is typed. `null` under a box that only reads the address out.
   */
  adresse: string | null;
  /** Why the tool refuses this reader the change, as the read serves it: a link would land on that refusal. */
  denied: FLAddressChangeViewableDenied | null;
}) {
  const saisonHref = useSaisonHref();

  return (
    <p className="fluid-sm text-pretty text-foreground">
      {adresse === null ? (
        "Für diese Adresse"
      ) : (
        <>
          Für <span className="break-all">{adresse}</span>
        </>
      )}{" "}
      läuft eine Änderung.{" "}
      {denied === null ? (
        <Link
          href={saisonHref(`/area/admin/adresswechsel?adresswechsel=${adresswechselId}`)}
          prefetch={false}
          className={textLink()}>
          {ZUR_AENDERUNG}
        </Link>
      ) : (
        EINSEHBAR_VERWEHRT[denied]
      )}
    </p>
  );
}
