"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@heroui/react";

import { useReportClientCrash } from "@/shared/hooks/useReportClientCrash";

import { CrashReportLink } from "./CrashReportLink";
import { DISPLAY_HEADING } from "./displayType";
import { ctaButton } from "./formButtons";
import { StatusPanel } from "./StatusPanel";

export function Error({
  error,
  reset,
  // The root boundary sits above every layout, so what failed there can be the chrome itself and it
  // renders none of it. A boundary under a shell passes `shell`
  // (`fl_frontend/src/app/(public)/error.tsx`).
  fills = "document",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  fills?: "document" | "shell";
}) {
  const router = useRouter();
  const [isRetrying, startRetrying] = useTransition();

  useReportClientCrash(error);

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
      fills={fills}
      badgeLabel="Spielunterbrechung"
      heading={
        <>
          Rote Karte: <br className="sm:hidden" />
          <span className="text-brand">Systemfehler</span>
        </>
      }
      message="Ein unerwarteter Fehler ist aufgetreten und wurde automatisch gemeldet."
      digest={error.digest}
      watermark={
        /* `motion-safe:` rather than the global shortening: a glyph this large pulsing behind text
           must stop entirely, not run fast. */
        <span
          className={`${DISPLAY_HEADING} text-foreground/20 sm:text-foreground/5 text-[5.5rem] leading-none motion-safe:animate-pulse sm:text-[10rem] md:text-[18rem] lg:text-[25rem]`}>
          Fehler
        </span>
      }>
      {/* Written in the phone's own reading order and reversed from `sm` up, so the row a keyboard
          walks is the row a reader sees at the width the site is mostly read at. */}
      <div className="mt-8 flex w-full flex-col gap-3 sm:mt-12 sm:flex-row-reverse sm:gap-4">
        <Link
          title="Zur Startseite"
          href="/"
          className={`${ctaButton({ intent: "primary", hover: "css" })} w-full`}>
          Zur Startseite
        </Link>

        <Button
          variant="ghost"
          onPress={handleRetry}
          isDisabled={isRetrying}
          className={`${ctaButton({ intent: "outline", hover: "aria" })} w-full`}>
          {isRetrying ? "Versucht erneut..." : "Erneut versuchen"}
        </Button>
      </div>

      <CrashReportLink digest={error.digest} />
    </StatusPanel>
  );
}
