"use client";

import Link from "next/link";

import { Button } from "@heroui/react";

export default function NotFound() {
  return (
    <div className="bg-background relative flex min-h-[100dvh] flex-col items-center justify-center overflow-hidden p-4 sm:p-6">
      {/* Watermark */}
      <div className="pointer-events-none mb-4 flex items-center justify-center select-none sm:absolute sm:inset-0 sm:mb-0">
        {/* motion-safe:, not the global shortening — see Error.tsx. */}
        <span className="text-foreground/20 sm:text-foreground/5 text-[7rem] leading-none font-black tracking-tighter motion-safe:animate-pulse sm:text-[15rem] md:text-[25rem] lg:text-[35rem]">
          404
        </span>
      </div>

      {/* Main Content Container */}
      <div className="bg-surface/70 border-border relative z-10 flex w-full max-w-2xl flex-col items-center rounded-2xl border p-6 text-center shadow-2xl backdrop-blur-xl sm:rounded-3xl sm:p-12 md:p-16">
        {/* Sleek System/VAR Badge */}
        <div className="bg-background border-border mb-6 flex items-center gap-2.5 rounded-full border px-3 py-1.5 shadow-sm sm:mb-8 sm:px-4">
          <div className="bg-danger h-2 w-2 animate-pulse rounded-full sm:h-2.5 sm:w-2.5" />
          <span className="text-foreground text-fluid-xxs sm:text-fluid-xs font-black tracking-widest uppercase">VAR Review</span>
        </div>

        {/* Theatrical Headline */}
        <h1 className="text-fluid-2xl text-foreground font-extrabold tracking-tight">
          Entscheidung: <br className="sm:hidden" />
          <span className="text-foreground-muted">Kein Treffer</span>
        </h1>

        <p className="text-fluid-base text-foreground-muted mt-4 max-w-md leading-relaxed font-medium sm:mt-5">
          Nach Überprüfung der Bilder steht fest: Die gesuchte Seite befindet sich im Abseits oder wurde vom Platz gestellt.
        </p>

        {/* Buttons */}
        <div className="mt-8 flex w-full flex-col-reverse justify-center gap-3 sm:mt-10 sm:flex-row sm:gap-4">
          <Button
            variant="ghost"
            aria-label="Zurück zur vorherigen Seite"
            onPress={() => window.history.back()}
            className="text-fluid-sm border-border hover:bg-muted/50 text-foreground hover:scale-hover h-12 w-full rounded-xl border bg-transparent px-8 font-semibold transition sm:w-auto">
            Zurück
          </Button>

          <Link
            title="Startseite"
            aria-label="Zur Startseite"
            href="/"
            className="text-fluid-sm bg-brand-solid hover:bg-brand-solid/90 text-brand-solid-foreground hover:scale-hover flex h-12 w-full items-center justify-center rounded-xl px-8 font-semibold shadow-md transition sm:w-auto">
            Zur Startseite
          </Link>
        </div>
      </div>
    </div>
  );
}
