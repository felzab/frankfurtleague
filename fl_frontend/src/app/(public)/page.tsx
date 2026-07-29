import { Suspense } from "react";
import Link from "next/link";

import RecentAndUpcomingSpieleGrid from "@/features/spiele/components/collections/RecentAndUpcomingSpieleGrid";

export default async function LandingPage() {
  return (
    <>
      {/** Content section */}
      <section className="flex w-full max-w-[1400px] flex-col gap-5 px-3 pt-4 pb-6 sm:px-6 lg:px-8 lg:pt-8">
        {/* HERO HUB GRID */}
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* Primary Hero Box */}
          <div className="border-border bg-surface relative flex flex-col justify-between overflow-hidden rounded-3xl border px-4 py-6 shadow-sm sm:p-8 lg:col-span-7">
            <div className="bg-brand-solid absolute top-0 left-0 z-10 h-1.5 w-full" />

            <div className="relative z-10 flex flex-col gap-4">
              <div className="border-brand/30 bg-brand/15 text-fluid-xs text-brand inline-flex w-fit items-center gap-2 rounded-full border px-4 py-1.5 font-bold shadow-xs">
                <span className="bg-brand-solid size-2 animate-ping rounded-full" />
                Saison 2026
              </div>

              <h1 className="text-fluid-3xl font-black tracking-tight uppercase">
                Die Saison läuft! Wer holt sich den <span className="text-brand">Titel</span>?
              </h1>

              <p className="text-fluid-sm text-foreground-muted max-w-xl font-medium">
                Sehe alle wichtigen Daten der Frankfurt-League ein, verfolge Spieltage, Ergebnisse, Tabellen und mehr...
              </p>
            </div>

            {/* CTA's*/}
            <div className="border-border relative z-10 mt-8 flex flex-wrap items-center gap-3 border-t pt-8">
              <Link
                href="/dashboard/spielplan#top"
                prefetch={false}
                className="bg-brand-solid text-fluid-sm shadow-brand/30 w-full rounded-xl px-7 py-3.5 text-center font-bold transition-all hover:scale-[1.02]">
                Spielplan →
              </Link>
              <Link
                href="/dashboard/saisontabelle#top"
                prefetch={false}
                className="bg-background border-border text-fluid-sm w-full rounded-xl border px-7 py-3.5 text-center font-bold transition-all hover:scale-[1.02]">
                Tabelle →
              </Link>
            </div>
          </div>

          {/* CTA's*/}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
            {/* CTA Card 1: Teams */}
            <Link
              href="/dashboard/teams#top"
              prefetch={false}
              className="border-border bg-surface hover:border-brand group relative flex items-center justify-between overflow-hidden rounded-2xl border p-5 shadow-xs transition-all hover:shadow-sm">
              <div className="relative z-10 flex flex-col gap-1">
                <span className="text-fluid-xxs text-brand font-extrabold tracking-widest uppercase">Schulen & Kader</span>
                <span className="text-fluid-sm text-foreground font-black">Alle Teams durchstöbern</span>
              </div>
              <span className="text-fluid-sm text-brand relative z-10 font-bold transition-transform group-hover:translate-x-1">→</span>
            </Link>

            {/* CTA Card 2: Tabelle */}
            <Link
              href="/dashboard/saisontabelle#top"
              prefetch={false}
              className="border-border bg-surface hover:border-brand group relative flex items-center justify-between overflow-hidden rounded-2xl border p-5 shadow-xs transition-all hover:shadow-sm">
              <div className="relative z-10 flex flex-col gap-1">
                <span className="text-fluid-xxs text-brand font-extrabold tracking-widest uppercase">Ranking</span>
                <span className="text-fluid-sm text-foreground font-black">Tabellenstand & Platzierungen</span>
              </div>
              <span className="text-fluid-sm text-brand relative z-10 font-bold transition-transform group-hover:translate-x-1">→</span>
            </Link>

            {/* CTA Card 3: Spielplan */}
            <Link
              href="/dashboard/spielplan#top"
              prefetch={false}
              className="border-border bg-surface hover:border-brand group relative flex items-center justify-between overflow-hidden rounded-2xl border p-5 shadow-xs transition-all hover:shadow-sm">
              <div className="relative z-10 flex flex-col gap-1">
                <span className="text-fluid-xxs text-brand font-extrabold tracking-widest uppercase">Matchday</span>
                <span className="text-fluid-sm text-foreground font-black">Ansetzungen & Ergebnisse</span>
              </div>
              <span className="text-fluid-sm text-brand relative z-10 font-bold transition-transform group-hover:translate-x-1">→</span>
            </Link>
          </div>
        </div>

        {/* SECONDARY INFO & CONTENT STRIP */}
        <div className="border-border bg-surface relative flex w-full flex-col items-center justify-between gap-6 overflow-hidden rounded-2xl border px-4 py-4 shadow-xs sm:px-6 lg:flex-row lg:py-6">
          <div className="relative z-10 flex items-center gap-3">
            <span className="bg-brand-solid min-h-2 min-w-2 animate-pulse rounded-full" />
            <span className="text-fluid-sm text-foreground font-bold">Du hast Fragen zum Turnierablauf oder möchtest mit uns sprechen?</span>
          </div>

          <div className="relative z-10 flex w-full flex-col items-stretch gap-3 sm:flex-row lg:w-auto lg:shrink-0">
            <Link
              href="/about"
              prefetch={false}
              className="bg-brand-solid text-fluid-xs flex h-10 w-full items-center justify-center rounded-xl px-4 font-bold text-white transition-all hover:scale-[1.02] lg:w-56">
              Mehr über das Projekt
            </Link>
            <Link
              href="/kontakt"
              prefetch={false}
              className="bg-background border-border text-fluid-xs text-foreground flex h-10 w-full items-center justify-center rounded-xl border px-4 font-bold transition-all hover:scale-[1.04] lg:w-44">
              Zum Kontakt
            </Link>
          </div>
        </div>
      </section>

      {/* GAMES CONTAINER */}
      <div className="w-full max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
        <Suspense
          fallback={
            <div className="flex w-full justify-center py-20">
              <span className="text-fluid-sm text-foreground-muted animate-pulse italic">Spiele werden geladen...</span>
            </div>
          }>
          <RecentAndUpcomingSpieleGrid />
        </Suspense>
      </div>
    </>
  );
}
