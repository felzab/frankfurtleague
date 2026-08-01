"use client";

import Link from "next/link";

import { Button } from "@heroui/react";

import { ctaButton } from "./formButtons";
import { StatusPanel } from "./StatusPanel";

export function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <StatusPanel
      badgeLabel="Spielunterbrechung"
      heading={
        <>
          Rote Karte: <br className="sm:hidden" />
          <span className="text-brand">Systemfehler</span>
        </>
      }
      message="Der Schiedsrichter hat die Partie vorübergehend gestoppt, da ein unerwarteter Fehler aufgetreten ist. Die Platzwarte sind bereits informiert."
      digest={error.digest}
      watermark={
        /* motion-safe:, not the global shortening: a 25rem glyph pulsing behind text the user is
           trying to read must stop entirely, not run fast. */
        <span className="text-foreground/20 sm:text-foreground/5 text-[5.5rem] leading-none font-black tracking-tighter motion-safe:animate-pulse sm:text-[10rem] md:text-[18rem] lg:text-[25rem]">
          ERROR
        </span>
      }>
      <div className="mt-8 flex w-full flex-col-reverse gap-3 sm:mt-10 sm:flex-row sm:gap-4">
        <Button
          variant="ghost"
          onPress={() => reset()}
          className={`${ctaButton({ intent: "outline" })} w-full`}>
          Erneut versuchen
        </Button>

        <Link
          title="Startseite"
          href="/"
          className={`${ctaButton({ intent: "primary" })} w-full`}>
          Zur Startseite
        </Link>
      </div>
    </StatusPanel>
  );
}
