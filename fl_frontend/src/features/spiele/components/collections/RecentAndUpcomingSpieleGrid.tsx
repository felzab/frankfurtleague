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
      <p className="text-fluid-base pt-10 text-center whitespace-normal italic">Nächste/Vergangene Spiele konnten nicht geladen werden.</p>
    );
  }

  return (
    /** Small preview of upcoming matches etc. */
    <section className="mt-5 flex h-fit min-h-[600px] w-[90%] flex-col items-center pb-20 lg:w-[95%]">
      {/** Displays upcoming 6 games */}
      <div className="flex h-full w-full flex-col items-center pb-5">
        <h2 className="text-fluid-xl border-quaternary-light dark:border-quaternary-dark w-fit border-b-4 font-extrabold">Nächste Spiele</h2>

        <div className="mt-2 flex w-full flex-col items-center gap-2 lg:grid lg:grid-cols-2 lg:grid-rows-3 lg:place-items-center 2xl:grid-cols-3 2xl:grid-rows-2">
          <SpielCardsList spiele={upcomingSpieleRes.spiele} />
        </div>
      </div>

      {/** Displays recent 6 games */}
      <div className="flex h-full w-full flex-col items-center">
        <h2 className="text-fluid-xl w-fit border-b-4 border-red-400 font-extrabold dark:border-red-600">Vergangene Spiele</h2>
        <div className="mt-2 flex w-full flex-col items-center gap-2 lg:grid lg:grid-cols-2 lg:grid-rows-3 lg:place-items-center 2xl:grid-cols-3 2xl:grid-rows-2">
          <SpielCardsList spiele={recentSpieleRes.spiele} />
        </div>
      </div>
    </section>
  );
}
