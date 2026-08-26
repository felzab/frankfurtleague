import { connection } from "next/server";

import { EmptyState } from "@/shared/components/ui/EmptyState";
import { CARDS_CASCADE } from "@/shared/components/ui/motion";
import { getGermanTodayStr } from "@/shared/utils/date";

import { getSpiele } from "../../queries";
import { SpielCardSkeletonGrid } from "../ui/SpielCardSkeleton";
import { SpielCardsList } from "./SpielCardsList";

import type { FLSpieleListResponse } from "../../schemas";

/** Shared with the skeleton: zero layout shift holds only while the two render identical chrome. */
function SectionHeader({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-6 flex flex-col gap-1">
      <span className="fluid-xxs text-brand font-extrabold tracking-widest uppercase">{eyebrow}</span>
      <h2 className="fluid-2xl text-foreground font-black tracking-tight">{title}</h2>
    </div>
  );
}

const SECTION_GRID = `${CARDS_CASCADE} grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3`;

/**
 * Roughly one card row. Without it an empty or failed section collapses to a single line, the page
 * ends far shorter than expected, and the footer rides up into view.
 */
const SECTION_MIN_HEIGHT = "min-h-44";

/**
 * The landing page's `Suspense` fallback. Its count matches the `limit` below, so the skeleton
 * reserves exactly what the query can return and the swap moves nothing.
 */
export function RecentAndUpcomingSpieleGridSkeleton() {
  return (
    <section className="flex w-full flex-col gap-14 pb-10">
      <div className="flex w-full flex-col">
        <SectionHeader
          eyebrow="Demnächst"
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

/**
 * **The two sections resolve independently**: one guard over both would discard a healthy set of
 * past results because the upcoming query timed out. `res === null` is a failed fetch and an empty
 * `spiele` a successful one — only one is worth retrying.
 */
function SectionBody({ res, today, emptyTitle }: { res: FLSpieleListResponse | null; today: string; emptyTitle: string }) {
  if (!res) {
    return (
      <EmptyState
        title="Spieldaten konnten nicht geladen werden."
        hint="Lade die Seite neu."
        className={SECTION_MIN_HEIGHT}
      />
    );
  }

  if (res.spiele.length === 0) {
    return (
      <EmptyState
        title={emptyTitle}
        className={SECTION_MIN_HEIGHT}
      />
    );
  }

  return (
    <div
      role="list"
      className={SECTION_GRID}>
      <SpielCardsList
        spiele={res.spiele}
        today={today}
      />
    </div>
  );
}

export async function RecentAndUpcomingSpieleGrid() {
  await connection();
  const [upcomingSpieleRes, recentSpieleRes] = await Promise.all([
    getSpiele({ spiel_status: "ausstehend", limit: 6 }).catch(() => null),
    getSpiele({ spiel_status: "vergangen", sort_by: "datum", order: "desc", limit: 6 }).catch(() => null),
  ]);

  // Safe to read the clock: `connection()` above already made this dynamic.
  const today = getGermanTodayStr();

  return (
    <section className="flex w-full flex-col gap-14 pb-10">
      <div className="flex w-full flex-col">
        <SectionHeader
          eyebrow="Demnächst"
          title="Nächste Begegnungen"
        />
        <SectionBody
          res={upcomingSpieleRes}
          today={today}
          emptyTitle="Aktuell sind keine Spiele angesetzt."
        />
      </div>

      <div className="flex w-full flex-col">
        <SectionHeader
          eyebrow="Rückblick"
          title="Vergangene Spiele"
        />
        <SectionBody
          res={recentSpieleRes}
          today={today}
          emptyTitle="Es wurde noch kein Spiel ausgetragen."
        />
      </div>
    </section>
  );
}
