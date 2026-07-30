"use client";

import Link from "next/link";

import { Button } from "@heroui/react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="bg-background relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden p-4 sm:p-6">
      {/* Watermark */}
      <div className="pointer-events-none mb-4 flex items-center justify-center select-none sm:absolute sm:inset-0 sm:mb-0">
        {/* motion-safe:, not the global shortening: a 25rem glyph pulsing behind text the user is
            trying to read must stop entirely, not run fast. */}
        <span className="text-foreground/20 sm:text-foreground/5 motion-safe:animate-pulse text-[5.5rem] leading-none font-black tracking-tighter sm:text-[10rem] md:text-[18rem] lg:text-[25rem]">
          ERROR
        </span>
      </div>

      {/* Main Content Container */}
      <div className="bg-surface/70 border-border relative z-10 flex w-full max-w-2xl flex-col items-center rounded-2xl border p-6 text-center shadow-2xl backdrop-blur-xl sm:rounded-3xl sm:p-12 md:p-16">
        <div className="bg-background border-border mb-6 flex items-center gap-2.5 rounded-full border px-3 py-1.5 shadow-sm sm:mb-8 sm:px-4">
          <div className="bg-danger h-2 w-2 animate-pulse rounded-full sm:h-2.5 sm:w-2.5" />
          <span className="text-foreground text-[10px] font-black tracking-widest uppercase sm:text-xs">Spielunterbrechung</span>
        </div>

        <h1 className="text-fluid-2xl text-foreground font-extrabold tracking-tight">
          Rote Karte: <br className="sm:hidden" />
          <span className="text-brand">Systemfehler</span>
        </h1>

        <p className="text-fluid-base text-foreground-muted mt-4 max-w-md leading-relaxed font-medium sm:mt-5">
          Der Schiedsrichter hat die Partie vorübergehend gestoppt, da ein unerwarteter Fehler aufgetreten ist. Die Platzwarte sind bereits
          informiert.
        </p>

        {error.digest && <p className="text-foreground-muted/60 mt-4 font-mono text-xs tracking-wider">Fehler-Code: {error.digest}</p>}

        {/* Buttons */}
        <div className="mt-8 flex w-full flex-col-reverse gap-3 sm:mt-10 sm:flex-row sm:gap-4">
          <Button
            variant="ghost"
            aria-label="Retry"
            onPress={() => reset()}
            className="text-fluid-sm border-border text-foreground h-12 w-full rounded-xl border bg-transparent font-semibold transition-transform hover:scale-hover">
            Erneut versuchen
          </Button>

          <Link
            title="Homepage"
            aria-label="Link to Homepage"
            href="/"
            className="text-fluid-sm bg-brand-solid text-brand-solid-foreground flex h-12 w-full items-center justify-center rounded-xl font-semibold shadow-md transition-transform hover:scale-hover">
            Zur Startseite
          </Link>
        </div>
      </div>
    </div>
  );
}
