"use client";

import Link from "next/link";

import { domAnimation, LazyMotion, m } from "framer-motion";

export default function NotFound() {
  return (
    <LazyMotion features={domAnimation}>
      <div className="text-text-white relative flex h-full w-full flex-1 flex-col items-center justify-center overflow-hidden bg-emerald-600 py-15 font-sans">
        {/* --- DAS HORIZONTALE SPIELFELD --- */}
        <div className="pointer-events-none absolute inset-0 z-0">
          {/* Gras-Textur / Streifen */}
          <div className="absolute inset-0 flex">
            <div className={"h-full flex-1 bg-emerald-500/30"} />
            <div className={"h-full flex-1 bg-transparent"} />
            <div className={"h-full flex-1 bg-emerald-500/30"} />
            <div className={"h-full flex-1 bg-transparent"} />
            <div className={"h-full flex-1 bg-emerald-500/30"} />
            <div className={"h-full flex-1 bg-transparent"} />
            <div className={"h-full flex-1 bg-emerald-500/30"} />
            <div className={"h-full flex-1 bg-transparent"} />
            <div className={"h-full flex-1 bg-emerald-500/30"} />
            <div className={"h-full flex-1 bg-transparent"} />
          </div>

          {/* Spielfeldmarkierungen (Horizontal von links nach rechts) */}
          <div className="absolute inset-x-0 top-1/2 flex h-[90%] -translate-y-1/2 items-center justify-between border-y-4 border-white/40 px-4">
            {/* Linkes Tor / Strafraum */}
            <div className="h-1/3 w-16 border-4 border-l-0 border-white/40 lg:h-2/3 lg:w-32" />

            {/* Mittellinie */}
            <div className="absolute top-0 bottom-0 left-1/2 flex w-1 -translate-x-1/2 items-center justify-center bg-white/40">
              <div className="h-48 w-48 rounded-full border-4 border-white/40" />
            </div>

            {/* Rechtes Tor / Strafraum */}
            <div className="h-1/3 w-16 border-4 border-r-0 border-white/40 lg:h-2/3 lg:w-32" />
          </div>
        </div>

        {/* --- ANIMIERTER CONTENT --- */}
        <div className="relative z-10 flex flex-col items-center">
          {/* Die 4-0-4 Animation */}
          <div className="mb-8 flex items-center justify-center gap-4">
            <m.span
              initial={{ x: -100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="text-[8rem] leading-none font-black drop-shadow-2xl sm:text-[12rem] lg:text-[17rem]">
              4
            </m.span>

            {/* Der Ball als "0", der über das Feld rollt */}
            <m.div
              initial={{ x: -1000, rotate: -720 }}
              animate={{ x: 0, rotate: 0 }}
              transition={{ type: "spring", damping: 12, stiffness: 50 }}
              className="relative">
              <div className="text-[6rem] drop-shadow-2xl sm:text-[10rem] lg:text-[12rem]">⚽</div>
              {/* Sprechblase wie im Bild */}
              <m.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 1 }}
                className="absolute -top-12 -right-12 rounded-2xl rounded-bl-none bg-white px-4 py-2 font-bold whitespace-nowrap text-emerald-900 shadow-xl">
                Huch! Abseits!
              </m.div>
            </m.div>

            <m.span
              initial={{ x: 100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="text-[8rem] leading-none font-black drop-shadow-2xl sm:text-[12rem] lg:text-[17rem]">
              4
            </m.span>
          </div>

          {/* Texte wie im Bild */}
          <m.div
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="px-4 text-center">
            <h1 className="text-fluid-xl mb-4 font-extrabold drop-shadow-md">404 - Seite nicht gefunden</h1>
            <p className="text-fluid-base w-full font-medium whitespace-normal italic drop-shadow-sm">
              Das ist wohl kein Tor für dich! Der Schiedsrichter hat ein Foul gepfiffen.
            </p>
          </m.div>

          {/* Interaktive Buttons */}
          <m.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="mt-12 flex w-full flex-col gap-6 px-6 sm:flex-row">
            <Link
              title="Link to homepage"
              href="/"
              className="text-fluid-base h-fit w-full rounded-2xl bg-white py-4 text-center font-black tracking-wider text-emerald-900 uppercase shadow-xl transition-colors hover:bg-emerald-50">
              Zur Startseite
            </Link>
            <button
              onClick={() => window.history.back()}
              className="text-fluid-base h-fit w-full rounded-2xl border-2 border-white/50 bg-emerald-700/50 py-4 text-center font-black tracking-wider text-white uppercase backdrop-blur-md transition-colors hover:bg-emerald-700">
              Zurück
            </button>
          </m.div>
        </div>

        {/* Rote Karte Effekt am Rand */}
        <m.div
          initial={{ y: 300 }}
          animate={{ y: [300, 0, 0, 300] }}
          transition={{ duration: 4, repeat: Infinity, repeatDelay: 2 }}
          className="absolute right-10 bottom-10 z-20 flex h-36 w-24 items-center justify-center rounded-lg border-4 border-red-500 bg-red-600 shadow-2xl">
          <span className="rotate-90 text-center text-sm font-black text-white">REF</span>
        </m.div>
      </div>
    </LazyMotion>
  );
}
