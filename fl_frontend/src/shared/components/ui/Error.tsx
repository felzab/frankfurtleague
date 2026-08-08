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

  // Captured once, when the boundary mounts — which is as close to the incident as the client can
  // date it. Click time would drift by however long the reader hesitated.
  const [occurredAt] = useState(() => new Date().toISOString());

  // The three coordinates docs/logging.md asks a report to carry. A digest names an error CLASS —
  // every network failure shares one — so the route and the time are what narrow it to the one log
  // entry whose correlation id opens every surface's lines. A client crash has no digest, and
  // saying so is itself a coordinate: it points at the client-error stream instead.
  const reportSubject = `Fehlerbericht: ${error.digest ?? "Client-Fehler"} auf ${pathname}`;
  const reportBody = [
    "Hallo Frankfurt-League-Team,",
    "",
    "[Beschreibe hier kurz, was Du gerade tun wolltest und was stattdessen passiert ist.]",
    "",
    "— Technische Angaben, für die Zuordnung —",
    `Digest: ${error.digest ?? "keiner (Client-Fehler)"}`,
    `Route: ${pathname}`,
    `Zeitpunkt: ${occurredAt}`,
  ].join("\n");
  const reportHref = `mailto:${KONTAKT_EMAIL}?subject=${encodeURIComponent(reportSubject)}&body=${encodeURIComponent(reportBody)}`;

  /**
   * `reset()` alone re-renders the failed segment FROM THE ROUTER'S CACHE, so for a server-side
   * failure it replayed the same broken payload and the button visibly did nothing — the browser's
   * own reload worked precisely because it refetched. `router.refresh()` first is what makes the
   * retry a real second attempt: it drops the cached payload and refetches from the server, and
   * `reset()` then clears the error boundary over the fresh result.
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
        /* motion-safe:, not the global shortening: a 25rem glyph pulsing behind text the user is
           trying to read must stop entirely, not run fast. */
        <span className="text-foreground/20 sm:text-foreground/5 text-[5.5rem] leading-none font-black tracking-tighter motion-safe:animate-pulse sm:text-[10rem] md:text-[18rem] lg:text-[25rem]">
          ERROR
        </span>
      }>
      <div className="mt-8 flex w-full flex-col-reverse gap-3 sm:mt-10 sm:flex-row sm:gap-4">
        <Button
          variant="ghost"
          onPress={handleRetry}
          isDisabled={isRetrying}
          className={`${ctaButton({ intent: "outline" })} w-full`}>
          {isRetrying ? "Versucht erneut..." : "Erneut versuchen"}
        </Button>

        <Link
          title="Startseite"
          href="/"
          className={`${ctaButton({ intent: "primary" })} w-full`}>
          Zur Startseite
        </Link>
      </div>

      {/* A mailto, deliberately not a form (roadmap FE-6): the crash itself is already logged on
          both sides, so what a report adds is the human half — intent, steps, expectation — and a
          second public write path for that would guard nothing the rate-limited ingest route does
          not. The link is the quiet third action: useful, never competing with Erneut versuchen. */}
      <a
        href={reportHref}
        className="fluid-xs text-foreground-muted hover:text-foreground mt-6 underline underline-offset-4 transition-colors">
        Fehler per E-Mail melden — die technischen Angaben sind schon ausgefüllt
      </a>
    </StatusPanel>
  );
}
