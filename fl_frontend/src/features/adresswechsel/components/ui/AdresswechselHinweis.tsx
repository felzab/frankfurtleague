"use client";

import Link from "next/link";

import { ADRESSWECHSEL_EINTRAG } from "@/features/admin/constants";
import { EINSEHBAR_VERWEHRT } from "@/features/adresswechsel/einsehbar";
import { textLink } from "@/shared/components/ui/textLink";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";

import type { EinsehbarVerwehrt } from "@/features/adresswechsel/einsehbar";

const ZUR_AENDERUNG = "Zur Änderung";

/** The one line every editor shows under an address a change is pending at, one change for every record it holds. */
export function AdresswechselOffen({
  adresswechselId,
  adresse,
  verwehrt,
}: {
  adresswechselId: string;
  /**
   * The stored address the change is at, named where the box above it takes input: „diese Adresse“ would then point at
   * whatever is typed. `null` under a box that only reads the address out.
   */
  adresse: string | null;
  /** Why the tool refuses this reader the change, as the read serves it: a link would land on that refusal. */
  verwehrt: EinsehbarVerwehrt | null;
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
      {verwehrt === null ? (
        <Link
          href={saisonHref(`/bereich/admin/adresswechsel?adresswechsel=${adresswechselId}`)}
          prefetch={false}
          className={textLink()}>
          {ZUR_AENDERUNG}
        </Link>
      ) : (
        EINSEHBAR_VERWEHRT[verwehrt]
      )}
    </p>
  );
}

/**
 * Under a sign-in address on the pupil and referee editors, the same words on each: they read the address and its
 * pending change and change neither. One tool for every editor, so a change is seen from each.
 */
export function AdresswechselHinweis({ adresswechselId, verwehrt }: { adresswechselId: string | null; verwehrt: EinsehbarVerwehrt | null }) {
  const saisonHref = useSaisonHref();

  return (
    <div className="flex flex-col gap-1">
      {adresswechselId !== null && (
        <AdresswechselOffen
          adresswechselId={adresswechselId}
          adresse={null}
          verwehrt={verwehrt}
        />
      )}
      <p className="muted-hint text-pretty">
        Mit dieser Adresse meldet sich die Person an. Eine neue trägt sie selbst in ihrem Konto ein. Kann sie sich nicht mehr anmelden, ändert
        die Verwaltung sie unter{" "}
        <Link
          href={saisonHref("/bereich/admin/adresswechsel")}
          prefetch={false}
          className={textLink()}>
          „{ADRESSWECHSEL_EINTRAG.label}“
        </Link>
        .
      </p>
    </div>
  );
}
