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
      <p className="text-fluid-base whitespace-normal text-center pt-10 italic">Nächste/Vergangene Spiele konnten nicht geladen werden.</p>
    );
  }

  return (
    /** Small preview of upcoming matches etc. */
    <section className="flex flex-col items-center w-[90%] lg:w-[95%] h-fit min-h-[600px] mt-5 pb-20">
      {/** Displays upcoming 6 games */}
      <div className="flex flex-col items-center w-full h-full pb-5">
        <h2 className="w-fit text-fluid-xl font-extrabold border-b-4 border-quaternary-light dark:border-quaternary-dark">Nächste Spiele</h2>

        <div className="flex flex-col items-center gap-2 w-full mt-2 lg:grid lg:grid-cols-2 lg:grid-rows-3 lg:place-items-center 2xl:grid-cols-3 2xl:grid-rows-2 ">
          <SpielCardsList spiele={upcomingSpieleRes.spiele} />
        </div>
      </div>

      {/** Displays recent 6 games */}
      <div className="flex flex-col items-center w-full h-full">
        <h2 className="w-fit text-fluid-xl font-extrabold border-b-4 border-red-400 dark:border-red-600">Vergangene Spiele</h2>
        <div className="flex flex-col items-center gap-2 w-full mt-2 lg:grid lg:grid-cols-2 lg:grid-rows-3 lg:place-items-center 2xl:grid-cols-3 2xl:grid-rows-2 ">
          <SpielCardsList spiele={recentSpieleRes.spiele} />
        </div>
      </div>
    </section>
  );
}
