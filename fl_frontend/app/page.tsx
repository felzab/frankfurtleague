import SpielePreview from "@/features/spiele/components/SpielePreview";
import Link from "next/link";

export default async function LandingPage() {
  return (
    <>
      {/** Headline */}
      <section className="relative flex items-center justify-center w-full h-50 lg:h-74 bg-fl-red">
        <div className="absolute inset-0 bg-linear-to-t from-black/60 to-transparent z-1"></div>

        {/** Bild/Logo */}
        <div className="z-2 text-center">
          <h1 className="text-fluid-xl font-extrabold text-text-white tracking-tighter uppercase italic ">Frankfurt-League</h1>
          <p className="mt-4 text-fluid-base text-text-white font-semibold">Die Frankfurter Oberstufenliga</p>
        </div>
      </section>

      {/** Call-to-action bar */}
      <section className="flex flex-row justify-evenly items-center w-[90%] lg:w-[80%] xl:w-[70%] h-[70px] sm:h-[80px] lg:h-[100px] p-1 -mt-8 rounded-xl bg-text-black dark:bg-text-white text-text-white text-fluid-base z-3">
        <Link
          title="Link to page: Spielplan"
          href="/dashboard/spielplan#top"
          className="flex items-center justify-center w-[30%] h-[45px] sm:h-[55px] lg:h-[60px] rounded-md font-bold bg-quaternary-dark">
          Spielplan
        </Link>
        <Link
          title="Link to page: Saisontabelle"
          href="/dashboard/saisontabelle#top"
          className="flex items-center justify-center w-[30%] h-[45px] sm:h-[55px] lg:h-[60px] px-8 rounded-md font-bold bg-red-600">
          Tabelle
        </Link>
        <Link
          title="Link to page: Teams"
          href="/dashboard/spieler#top"
          className="flex items-center justify-center w-[30%] h-[45px] sm:h-[55px] lg:h-[60px] px-8 rounded-md font-bold bg-quinary-dark">
          Teams
        </Link>
      </section>
      <SpielePreview />
    </>
  );
}
