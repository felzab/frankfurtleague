"use client";

import Link from "next/link";

import { ADRESSWECHSEL_EINTRAG } from "@/features/admin/constants";
import { textLink } from "@/shared/components/ui/textLink";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";

const ZUR_AENDERUNG = "Zur Änderung";

/** The one line every editor shows under an address a change is pending at, one change for every record it holds. */
export function AdresswechselOffen({ adresswechselId }: { adresswechselId: string }) {
  const saisonHref = useSaisonHref();

  return (
    <p className="fluid-sm text-pretty text-foreground">
      Für diese Adresse läuft eine Änderung.{" "}
      <Link
        href={saisonHref(`/bereich/admin/adresswechsel?adresswechsel=${adresswechselId}`)}
        prefetch={false}
        className={textLink()}>
        {ZUR_AENDERUNG}
      </Link>
    </p>
  );
}

/**
 * Under a sign-in address on the pupil and referee editors, the same words on each: they read the address and its
 * pending change and change neither. One tool for every editor, so a change is seen from each.
 */
export function AdresswechselHinweis({ adresswechselId }: { adresswechselId: string | null }) {
  const saisonHref = useSaisonHref();

  return (
    <div className="flex flex-col gap-1">
      {adresswechselId !== null && <AdresswechselOffen adresswechselId={adresswechselId} />}
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
