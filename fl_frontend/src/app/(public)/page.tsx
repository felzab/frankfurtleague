import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";

import { getCurrentSaison } from "@/features/saisons/queries";
import {
  RecentAndUpcomingSpieleGrid,
  RecentAndUpcomingSpieleGridSkeleton,
} from "@/features/spiele/components/collections/RecentAndUpcomingSpieleGrid";
import { card } from "@/shared/components/ui/card";
import { ctaButton } from "@/shared/components/ui/formButtons";

export default function LandingPage() {
  return (
    <>
      <section className="max-w-page flex w-full flex-col gap-5 px-3 pt-4 pb-6 sm:px-6 lg:px-8 lg:pt-8">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          <div className="border-border bg-surface relative flex flex-col justify-between overflow-hidden rounded-3xl border px-4 py-6 shadow-sm sm:p-8 lg:col-span-7">
            <div className="bg-brand-solid absolute top-0 left-0 z-10 h-1.5 w-full" />

            <div className="relative z-10 flex flex-col gap-4">
              {/* `/10`, not `/15`: bold normal-size text needs 4.5:1 against its own tint, and 10% measures
                  4.70:1 in the dark theme where 15% drops to 4.42:1. Re-measure if --accent-brand moves. */}
              <div className="border-brand/30 bg-brand/10 fluid-xs text-brand inline-flex w-fit items-center gap-2 rounded-full border px-4 py-1.5 font-bold shadow-xs">
                <span className="bg-brand-solid size-2 animate-ping rounded-full" />
                {/* The fallback holds the label's exact box invisibly, so the year landing moves nothing. */}
                <Suspense fallback={<span className="invisible">Saison 0000</span>}>
                  <CurrentSaisonLabel />
                </Suspense>
              </div>

              <h1 className="fluid-3xl font-black tracking-tight uppercase">
                Die Saison läuft! Wer holt sich den <span className="text-brand">Titel</span>?
              </h1>

              <p className="muted-hint max-w-xl">
                Sehe alle wichtigen Daten der Frankfurt-League ein, verfolge Spieltage, Ergebnisse, Tabellen und mehr...
              </p>
            </div>

            <div className="border-border relative z-10 mt-8 flex flex-wrap items-center gap-3 border-t pt-8">
              <Link
                href="/dashboard/spielplan#top"
                prefetch={false}
                className={`${ctaButton({ intent: "primary", hover: "css" })} w-full`}>
                Spielplan
              </Link>
              <Link
                href="/dashboard/saisontabelle#top"
                prefetch={false}
                className={`${ctaButton({ intent: "outline", hover: "css" })} w-full`}>
                Tabelle
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:col-span-5 lg:grid-cols-1">
            <Link
              href="/dashboard/teams#top"
              prefetch={false}
              className={`${card({ interactive: true })} relative flex items-center justify-between overflow-hidden p-5`}>
              <div className="relative z-10 flex flex-col gap-1">
                <span className="fluid-xxs text-brand font-extrabold tracking-widest uppercase">Schulen & Kader</span>
                <span className="fluid-sm text-foreground font-black">Alle Teams durchstöbern</span>
              </div>
              <span className="fluid-sm text-brand relative z-10 font-bold">→</span>
            </Link>

            <Link
              href="/dashboard/saisontabelle#top"
              prefetch={false}
              className={`${card({ interactive: true })} relative flex items-center justify-between overflow-hidden p-5`}>
              <div className="relative z-10 flex flex-col gap-1">
                <span className="fluid-xxs text-brand font-extrabold tracking-widest uppercase">Ranking</span>
                <span className="fluid-sm text-foreground font-black">Tabellenstand & Platzierungen</span>
              </div>
              <span className="fluid-sm text-brand relative z-10 font-bold">→</span>
            </Link>

            <Link
              href="/dashboard/spielplan#top"
              prefetch={false}
              className={`${card({ interactive: true })} relative flex items-center justify-between overflow-hidden p-5`}>
              <div className="relative z-10 flex flex-col gap-1">
                <span className="fluid-xxs text-brand font-extrabold tracking-widest uppercase">Matchday</span>
                <span className="fluid-sm text-foreground font-black">Ansetzungen & Ergebnisse</span>
              </div>
              <span className="fluid-sm text-brand relative z-10 font-bold">→</span>
            </Link>
          </div>
        </div>

        <div className="border-border bg-surface relative flex w-full flex-col items-center justify-between gap-6 overflow-hidden rounded-2xl border px-4 py-4 shadow-xs sm:px-6 lg:flex-row lg:py-6">
          <div className="relative z-10 flex items-center gap-3">
            <span className="bg-brand-solid min-h-2 min-w-2 animate-pulse rounded-full" />
            <span className="fluid-sm text-foreground font-bold">Du hast Fragen zum Turnierablauf oder möchtest mit uns sprechen?</span>
          </div>

          <div className="relative z-10 flex w-full flex-col items-stretch gap-3 sm:flex-row lg:w-auto lg:shrink-0">
            <Link
              href="/about"
              prefetch={false}
              className={`${ctaButton({ intent: "primary", size: "sm", hover: "css" })} w-full lg:w-56`}>
              Mehr über das Projekt
            </Link>
            <Link
              href="/kontakt"
              prefetch={false}
              className={`${ctaButton({ intent: "outline", size: "sm", hover: "css" })} w-full lg:w-44`}>
              Zum Kontakt
            </Link>
          </div>
        </div>
      </section>

      <div className="max-w-page w-full px-4 py-8 sm:px-6 lg:px-8">
        {/* A skeleton, not a spinner, so the page holds roughly its final height and the footer does not
            jump when the data lands. Under-reserving is the safe direction — see `VISIBILITY` there. */}
        <Suspense fallback={<RecentAndUpcomingSpieleGridSkeleton />}>
          <RecentAndUpcomingSpieleGrid />
        </Suspense>
      </div>
    </>
  );
}

/**
 * `connection()` precedes the fetch: the Docker builder stage cannot reach FastAPI. Reads the same
 * daily `saisons` cache as the fixtures below, so a rollover moves the badge and them together.
 */
async function CurrentSaisonLabel() {
  await connection();
  const { saison } = await getCurrentSaison();

  return <>Saison {saison.id}</>;
}
