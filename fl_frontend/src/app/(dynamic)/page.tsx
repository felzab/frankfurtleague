import { Suspense } from "react";
import Link from "next/link";

import RecentAndUpcomingSpieleGrid from "@/features/spiele/components/collections/RecentAndUpcomingSpieleGrid";

export default async function LandingPage() {
  return (
    <>
      {/** Headline */}
      <section className="bg-fl-red relative flex h-50 w-full items-center justify-center lg:h-74">
        <div className="absolute inset-0 z-1 bg-linear-to-t from-black/60 to-transparent"></div>

        {/** Bild/Logo */}
        <div className="z-2 text-center">
          <h1 className="text-fluid-xl text-text-white font-extrabold tracking-tighter uppercase italic">Frankfurt-League</h1>
          <p className="text-fluid-base text-text-white mt-4 font-semibold">Die Frankfurter Oberstufenliga</p>
        </div>
      </section>

      {/** Call-to-action bar */}
      <section className="bg-text-black dark:bg-text-white text-text-white text-fluid-base z-3 -mt-8 flex h-[70px] w-[90%] flex-row items-center justify-evenly rounded-xl p-1 sm:h-[80px] lg:h-[100px] lg:w-[80%] xl:w-[70%]">
        <Link
          prefetch={false}
          title="Link to page: Spielplan"
          href="/dashboard/spielplan#top"
          className="bg-quaternary-dark flex h-[45px] w-[30%] items-center justify-center rounded-md font-bold sm:h-[55px] lg:h-[60px]">
          Spielplan
        </Link>
        <Link
          prefetch={false}
          title="Link to page: Saisontabelle"
          href="/dashboard/saisontabelle#top"
          className="flex h-[45px] w-[30%] items-center justify-center rounded-md bg-red-600 px-8 font-bold sm:h-[55px] lg:h-[60px]">
          Tabelle
        </Link>
        <Link
          prefetch={false}
          title="Link to page: Teams"
          href="/dashboard/teams#top"
          className="bg-quinary-dark flex h-[45px] w-[30%] items-center justify-center rounded-md px-8 font-bold sm:h-[55px] lg:h-[60px]">
          Teams
        </Link>
      </section>
      <Suspense fallback={<span className="text-fluid-sm opacity-80"> Spiele laden...</span>}>
        <RecentAndUpcomingSpieleGrid />
      </Suspense>
    </>
  );
}
