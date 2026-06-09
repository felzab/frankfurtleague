"use server";
import { connection } from "next/server";
import { getSpielePreview } from "../queries";
import SpielList from "./SpielDisplayList";

export default async function SpielePreview() {
  await connection();
  const gamesPreviewData = await getSpielePreview().catch(() => {
    return null;
  });
  if (!gamesPreviewData) {
    return (
      <p className="text-fluid-base whitespace-normal text-center pt-10 italic">Nächste/Vergangene Spiele konnten nicht geladen werden.</p>
    );
  }

  /** Created here for later use in comparing the date of a game to today */
  const today = new Date().toISOString().split("T")[0];

  return (
    /** Small preview of upcoming matches etc. */
    <section className="flex flex-col items-center w-[90%] lg:w-[95%] h-fit min-h-[600px] mt-5 pb-20">
      {/** Displays the next 6 games */}
      <div className="flex flex-col items-center w-full h-full pb-5">
        <h2 className="w-fit text-fluid-xl font-extrabold border-b-4 border-quaternary-light dark:border-quaternary-dark">Nächste Spiele</h2>

        <div className="flex flex-col items-center w-full mt-2 lg:grid lg:grid-cols-2 lg:grid-rows-3 lg:place-items-center 2xl:grid-cols-3 2xl:grid-rows-2 ">
          <SpielList
            spiele={gamesPreviewData.next_games}
            today={today}
          />
        </div>
      </div>

      {/** Displays the previous 6 games */}
      <div className="flex flex-col items-center w-full h-full">
        <h2 className="w-fit text-fluid-xl font-extrabold border-b-4 border-red-400 dark:border-red-600">Vergangene Spiele</h2>
        <div className="flex flex-col items-center w-full mt-2 lg:grid lg:grid-cols-2 lg:grid-rows-3 lg:place-items-center 2xl:grid-cols-3 2xl:grid-rows-2">
          <SpielList
            spiele={gamesPreviewData.previous_games}
            today={today}
          />
        </div>
      </div>
    </section>
  );
}
