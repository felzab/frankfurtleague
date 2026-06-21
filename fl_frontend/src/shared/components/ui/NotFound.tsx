"use client";

import { LazyMotion, domAnimation, m } from "framer-motion";
import Link from "next/link";

export default function NotFound() {
  return (
    <LazyMotion features={domAnimation}>
      <div className="relative flex-1 w-full h-full bg-emerald-600 flex flex-col items-center justify-center overflow-hidden font-sans text-text-white py-15">
        {/* --- DAS HORIZONTALE SPIELFELD --- */}
        <div className="absolute inset-0 z-0 pointer-events-none">
          {/* Gras-Textur / Streifen */}
          <div className="absolute inset-0 flex">
            <div className={"flex-1 h-full bg-emerald-500/30 "} />
            <div className={"flex-1 h-full bg-transparent"} />
            <div className={"flex-1 h-full bg-emerald-500/30 "} />
            <div className={"flex-1 h-full bg-transparent"} />
            <div className={"flex-1 h-full bg-emerald-500/30 "} />
            <div className={"flex-1 h-full bg-transparent"} />
            <div className={"flex-1 h-full bg-emerald-500/30 "} />
            <div className={"flex-1 h-full bg-transparent"} />
            <div className={"flex-1 h-full bg-emerald-500/30 "} />
            <div className={"flex-1 h-full bg-transparent"} />
          </div>

          {/* Spielfeldmarkierungen (Horizontal von links nach rechts) */}
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[90%] border-y-4 border-white/40 flex items-center justify-between px-4">
            {/* Linkes Tor / Strafraum */}
            <div className=" h-1/3 lg:h-2/3 w-16 lg:w-32 border-4 border-l-0 border-white/40" />

            {/* Mittellinie */}
            <div className="absolute left-1/2 top-0 bottom-0 w-1 bg-white/40 -translate-x-1/2 flex items-center justify-center">
              <div className="w-48 h-48 border-4 border-white/40 rounded-full" />
            </div>

            {/* Rechtes Tor / Strafraum */}
            <div className="h-1/3 lg:h-2/3 w-16 lg:w-32 border-4 border-r-0 border-white/40" />
          </div>
        </div>

        {/* --- ANIMIERTER CONTENT --- */}
        <div className="relative z-10 flex flex-col items-center">
          {/* Die 4-0-4 Animation */}
          <div className="flex items-center justify-center gap-4 mb-8">
            <m.span
              initial={{ x: -100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="text-[8rem] sm:text-[12rem] lg:text-[17rem] font-black leading-none drop-shadow-2xl">
              4
            </m.span>

            {/* Der Ball als "0", der über das Feld rollt */}
            <m.div
              initial={{ x: -1000, rotate: -720 }}
              animate={{ x: 0, rotate: 0 }}
              transition={{ type: "spring", damping: 12, stiffness: 50 }}
              className="relative">
              <div className="text-[6rem] sm:text-[10rem] lg:text-[12rem] drop-shadow-2xl">⚽</div>
              {/* Sprechblase wie im Bild */}
              <m.div
                initial={{ scale: 0, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 1 }}
                className="absolute -top-12 -right-12 bg-white text-emerald-900 px-4 py-2 rounded-2xl rounded-bl-none font-bold shadow-xl whitespace-nowrap">
                Huch! Abseits!
              </m.div>
            </m.div>

            <m.span
              initial={{ x: 100, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              className="text-[8rem] sm:text-[12rem] lg:text-[17rem] font-black leading-none drop-shadow-2xl">
              4
            </m.span>
          </div>

          {/* Texte wie im Bild */}
          <m.div
            initial={{ y: 50, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.5 }}
            className="text-center px-4">
            <h1 className="text-fluid-xl font-extrabold mb-4 drop-shadow-md">404 - Seite nicht gefunden</h1>
            <p className="text-fluid-base w-full whitespace-normal drop-shadow-sm font-medium italic">
              Das ist wohl kein Tor für dich! Der Schiedsrichter hat ein Foul gepfiffen.
            </p>
          </m.div>

          {/* Interaktive Buttons */}
          <m.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="flex flex-col sm:flex-row gap-6 mt-12 w-full px-6">
            <Link
              title="Link to homepage"
              href="/"
              className="py-4 text-fluid-base h-fit w-full bg-white text-emerald-900 font-black text-center rounded-2xl shadow-xl hover:bg-emerald-50 transition-colors uppercase tracking-wider">
              Zur Startseite
            </Link>
            <button
              onClick={() => window.history.back()}
              className="py-4 text-fluid-base h-fit w-full bg-emerald-700/50 backdrop-blur-md border-2 border-white/50 text-white font-black text-center rounded-2xl hover:bg-emerald-700 transition-colors uppercase tracking-wider">
              Zurück
            </button>
          </m.div>
        </div>

        {/* Rote Karte Effekt am Rand */}
        <m.div
          initial={{ y: 300 }}
          animate={{ y: [300, 0, 0, 300] }}
          transition={{ duration: 4, repeat: Infinity, repeatDelay: 2 }}
          className="absolute bottom-10 right-10 w-24 h-36 bg-red-600 rounded-lg shadow-2xl border-4 border-red-500 flex items-center justify-center z-20">
          <span className="text-white font-black text-center text-sm rotate-90">REF</span>
        </m.div>
      </div>
    </LazyMotion>
  );
}
