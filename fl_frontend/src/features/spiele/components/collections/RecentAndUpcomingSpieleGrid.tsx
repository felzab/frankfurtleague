import { connection } from "next/server";

import { EmptyState } from "@/shared/components/ui/EmptyState";
import { CARDS_CASCADE } from "@/shared/components/ui/motion";
import { getGermanTodayStr } from "@/shared/utils/date";

import { getSpiele } from "../../queries";
import { SpielCardSkeletonGrid } from "../ui/SpielCardSkeleton";
import { SpielCardsList } from "./SpielCardsList";

import type { FLSpieleListResponse } from "../../schemas";

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

const SECTION_GRID = `${CARDS_CASCADE} grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3`;

/**
 * The floor for a section with no cards in it — one `SpielCard` row, near enough (a card measures
 * ~176px at every breakpoint).
 *
 * This is the fix for the owner's footer report. A failed or empty section used to shrink to a single
 * centred line, so the page ended up several hundred pixels shorter than the viewport expected and
 * the footer rode up into view. Reserving a card row keeps the page roughly the height it would have
 * had, which is the same property `SpielCardSkeleton` gives the loading state.
 */
const SECTION_MIN_HEIGHT = "min-h-44";

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

/**
 * One section's contents: the cards, or a panel explaining why there are none.
 *
 * **The two sections resolve independently**, which is the point of extracting this. A single
 * `if (!upcoming || !recent)` guard used to replace the *entire* region — both headings included —
 * with one small box the moment either request failed. So a healthy set of past results was thrown
 * away because the upcoming query timed out, and the reader lost even the labels telling them what
 * was missing. Each section now answers for itself and the headings always survive.
 *
 * `res === null` is a failed fetch (the caller catches into `null`); an empty `spiele` is a
 * successful fetch with nothing in it. Different messages, because they are different situations —
 * one is worth retrying and the other is not.
 */
function SectionBody({ res, today, emptyTitle }: { res: FLSpieleListResponse | null; today: string; emptyTitle: string }) {
  if (!res) {
    return (
      <EmptyState
        title="Spieldaten konnten nicht geladen werden."
        hint="Der Server hat nicht geantwortet. Lade die Seite neu, um es erneut zu versuchen."
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

  // Safe to read the clock here: connection() above already made this component dynamic.
  const today = getGermanTodayStr();

  return (
    <section className="flex w-full flex-col gap-14 pb-10">
      {/* UPCOMING GAMES SECTION */}
      <div className="flex w-full flex-col">
        <SectionHeader
          eyebrow="Matchdays"
          title="Nächste Begegnungen"
        />
        <SectionBody
          res={upcomingSpieleRes}
          today={today}
          emptyTitle="Aktuell sind keine Spiele angesetzt."
        />
      </div>

      {/* RECENT GAMES SECTION */}
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
