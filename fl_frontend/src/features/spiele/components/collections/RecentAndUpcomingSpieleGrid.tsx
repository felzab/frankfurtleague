import { connection } from "next/server";

import { getSpiele } from "../../queries";
import SpielCardsList from "./SpielCardsList";

export default async function RecentAndUpcomingSpieleGrid() {
  await connection();
  const [upcomingSpieleRes, recentSpieleRes] = await Promise.all([
    getSpiele({ spiel_status: "ausstehend", limit: 6 }).catch(() => null),
    getSpiele({ spiel_status: "vergangen", sort_by: "datum", order: "desc", limit: 6 }).catch(() => null),
  ]);

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
        {/* Section Header */}
        <div className="mb-6 flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-fluid-xxs text-brand font-extrabold tracking-widest uppercase">Matchdays</span>
          </div>
          <h2 className="text-fluid-2xl text-foreground font-black tracking-tight">Nächste Begegnungen</h2>
        </div>

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SpielCardsList spiele={upcomingSpieleRes.spiele} />
        </div>
      </div>

      {/* RECENT GAMES SECTION */}
      <div className="flex w-full flex-col">
        {/* Section Header */}
        <div className="mb-6 flex flex-col gap-1">
          <span className="text-fluid-xxs text-foreground-muted font-extrabold tracking-widest uppercase">Rückblick</span>
          <h2 className="text-fluid-2xl text-foreground font-black tracking-tight">Vergangene Spiele</h2>
        </div>

        <div className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SpielCardsList spiele={recentSpieleRes.spiele} />
        </div>
      </div>
    </section>
  );
}
