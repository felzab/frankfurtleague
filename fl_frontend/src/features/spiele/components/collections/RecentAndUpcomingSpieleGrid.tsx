import { connection } from "next/server";

import { EmptyState } from "@/shared/components/ui/EmptyState";
import { getGermanTodayStr } from "@/shared/utils/date";

import { getSpiele } from "../../queries";
import { SpielCardSkeletonGrid } from "../SpielCardSkeleton";
import SpielCardsList from "./SpielCardsList";

/**
 * The heading block above each section. Shared by the grid and its skeleton on purpose: the skeleton
 * only guarantees zero layout shift while the two render identical chrome, and one definition is the
 * only way to keep that true.
 */
function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-6 flex flex-col gap-1">
      <span className="text-fluid-xxs text-brand font-extrabold tracking-widest uppercase">{eyebrow}</span>
      <h2 className="text-fluid-2xl text-foreground font-black tracking-tight">{title}</h2>
    </div>
  );
}

const SECTION_GRID = "grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3";

/**
 * The loading state for this grid — the same two sections, filled with `SpielCardSkeleton`s.
 *
 * Rendered as the landing page's `Suspense` fallback. `limit: 6` below is why the count is six: the
 * skeleton reserves exactly what the query can return, so the swap moves nothing.
 */
export function RecentAndUpcomingSpieleGridSkeleton() {
  return (
    <section className="flex w-full flex-col gap-14 pb-10">
      <div className="flex w-full flex-col">
        <SectionHeader
          eyebrow="Matchdays"
          title="Nächste Begegnungen"
        />
        <SpielCardSkeletonGrid />
      </div>
      <div className="flex w-full flex-col">
        <SectionHeader
          eyebrow="Rückblick"
          title="Vergangene Spiele"
        />
        <SpielCardSkeletonGrid />
      </div>
    </section>
  );
}

export default async function RecentAndUpcomingSpieleGrid() {
  await connection();
  const [upcomingSpieleRes, recentSpieleRes] = await Promise.all([
    getSpiele({ spiel_status: "ausstehend", limit: 6 }).catch(() => null),
    getSpiele({ spiel_status: "vergangen", sort_by: "datum", order: "desc", limit: 6 }).catch(() => null),
  ]);

  // Safe to read the clock here: connection() above already made this component dynamic.
  const today = getGermanTodayStr();

  if (!upcomingSpieleRes || !recentSpieleRes) {
    return (
      <div className="border-border bg-surface flex w-full flex-col items-center justify-center rounded-2xl border p-10 shadow-sm">
        <span className="text-fluid-base text-foreground-muted italic">Spieldaten konnten nicht geladen werden.</span>
      </div>
    );
  }

  return (
    <section className="flex w-full flex-col gap-14 pb-10">
      {/* UPCOMING GAMES SECTION */}
      <div className="flex w-full flex-col">
        <SectionHeader
          eyebrow="Matchdays"
          title="Nächste Begegnungen"
        />

        {upcomingSpieleRes.spiele.length === 0 ? (
          <EmptyState title="Aktuell sind keine Spiele angesetzt." />
        ) : (
          <div
            role="list"
            className={SECTION_GRID}>
            <SpielCardsList
              spiele={upcomingSpieleRes.spiele}
              today={today}
            />
          </div>
        )}
      </div>

      {/* RECENT GAMES SECTION */}
      <div className="flex w-full flex-col">
        <SectionHeader
          eyebrow="Rückblick"
          title="Vergangene Spiele"
        />

        {recentSpieleRes.spiele.length === 0 ? (
          <EmptyState title="Es wurde noch kein Spiel ausgetragen." />
        ) : (
          <div
            role="list"
            className={SECTION_GRID}>
            <SpielCardsList
              spiele={recentSpieleRes.spiele}
              today={today}
            />
          </div>
        )}
      </div>
    </section>
  );
}
