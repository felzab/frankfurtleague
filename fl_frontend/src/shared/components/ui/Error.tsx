"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { Button } from "@heroui/react";

import { KONTAKT_EMAIL } from "@/core/brand";

import { ctaButton } from "./formButtons";
import { StatusPanel } from "./StatusPanel";

export function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isRetrying, startRetrying] = useTransition();

  // Captured at mount, as close to the incident as the client can date it; click time would drift.
  const [occurredAt] = useState(() => new Date().toISOString());

  // The three coordinates `docs/logging/spec.md` asks a report to carry: a digest names an error class, so
  // the route and the time narrow it to one entry. A client crash has no digest, and saying so is the pointer.
  const reportSubject = `Fehlerbericht: ${error.digest ?? "Client-Fehler"} auf ${pathname}`;
  const reportBody = [
    "Hallo Frankfurt-League-Team,",
    "",
    "[Beschreibe hier kurz, was Du gerade tun wolltest und was stattdessen passiert ist.]",
    "",
    "Technische Angaben, für die Zuordnung:",
    `Digest: ${error.digest ?? "keiner (Client-Fehler)"}`,
    `Route: ${pathname}`,
    `Zeitpunkt: ${occurredAt}`,
  ].join("\n");
  const reportHref = `mailto:${KONTAKT_EMAIL}?subject=${encodeURIComponent(reportSubject)}&body=${encodeURIComponent(reportBody)}`;

  /**
   * `reset()` alone re-renders the failed segment from the router's cache, replaying the same broken payload for a
   * server-side failure. `router.refresh()` first is what makes the retry a real second attempt.
   */
  const handleRetry = () => {
    startRetrying(() => {
      router.refresh();
      reset();
    });
  };

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
        /* `motion-safe:` rather than the global shortening: a glyph this large pulsing behind text
           must stop entirely, not run fast. */
        <span className="text-foreground/20 sm:text-foreground/5 text-[5.5rem] leading-none font-black tracking-tighter motion-safe:animate-pulse sm:text-[10rem] md:text-[18rem] lg:text-[25rem]">
          ERROR
        </span>
      }>
      <div className="mt-8 flex w-full flex-col-reverse gap-3 sm:mt-10 sm:flex-row sm:gap-4">
        <Button
          variant="ghost"
          onPress={handleRetry}
          isDisabled={isRetrying}
          className={`${ctaButton({ intent: "outline", hover: "aria" })} w-full`}>
          {isRetrying ? "Versucht erneut..." : "Erneut versuchen"}
        </Button>

        <Link
          title="Startseite"
          href="/"
          className={`${ctaButton({ intent: "primary", hover: "css" })} w-full`}>
          Zur Startseite
        </Link>
      </div>

      {/* A mailto rather than a form: the crash is already logged on both sides, so what a report adds is the
          human half, and a second public write path would guard nothing the ingest route does not. */}
      <a
        href={reportHref}
        className="fluid-xs text-foreground-muted hover:text-foreground mt-6 underline underline-offset-4 transition-colors">
        Fehler per E-Mail melden. Die technischen Angaben sind schon ausgefüllt.
      </a>
    </StatusPanel>
  );
}
