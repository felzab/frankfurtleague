"use client";

import Link from "next/link";

import { Button } from "@heroui/react";

import { ctaButton } from "./formButtons";
import { StatusPanel } from "./StatusPanel";

export default function NotFound() {
  return (
    <StatusPanel
      badgeLabel="VAR Review"
      heading={
        <>
          Entscheidung: <br className="sm:hidden" />
          <span className="text-foreground-muted">Kein Treffer</span>
        </>
      }
      message="Nach Überprüfung der Bilder steht fest: Die gesuchte Seite befindet sich im Abseits oder wurde vom Platz gestellt."
      watermark={
        /* motion-safe:, not the global shortening — see Error.tsx. */
        <span className="text-foreground/20 sm:text-foreground/5 text-[7rem] leading-none font-black tracking-tighter motion-safe:animate-pulse sm:text-[15rem] md:text-[25rem] lg:text-[35rem]">
          404
        </span>
      }>
      <div className="mt-8 flex w-full flex-col-reverse justify-center gap-3 sm:mt-10 sm:flex-row sm:gap-4">
        <Button
          variant="ghost"
          aria-label="Zurück zur vorherigen Seite"
          onPress={() => window.history.back()}
          className={`${ctaButton({ intent: "outline" })} w-full px-8 sm:w-auto`}>
          Zurück
        </Button>

        <Link
          title="Startseite"
          aria-label="Zur Startseite"
          href="/"
          className={`${ctaButton({ intent: "primary" })} w-full px-8 sm:w-auto`}>
          Zur Startseite
        </Link>
      </div>
    </StatusPanel>
  );
}
