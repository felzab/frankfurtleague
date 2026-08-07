"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@heroui/react";

import { ctaButton } from "./formButtons";
import { StatusPanel } from "./StatusPanel";

export function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter();
  const [isRetrying, startRetrying] = useTransition();

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
    </StatusPanel>
  );
}
