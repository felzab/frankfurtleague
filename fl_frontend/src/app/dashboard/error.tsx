"use client";

import { Button } from "@heroui/react";

export default function SoccerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="relative my-6 flex h-full min-h-dvh w-[95%] flex-col items-center justify-center overflow-hidden rounded-2xl">
      {/* --- BACKGROUND: Stylized Soccer Pitch (Pure CSS) --- */}
      <div className="pointer-events-none absolute inset-0 opacity-80">
        {/* Grass gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-green-600/50 to-[#0d542ba2]" />
        {/* Halfway line */}
        <div className="absolute top-1/2 left-0 h-[2px] w-full -translate-y-1/2 bg-white/40" />
        {/* Center circle */}
        <div className="absolute top-1/2 left-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border-[2px] border-white/40 sm:h-48 sm:w-48" />
        {/* Center spot */}
        <div className="absolute top-1/2 left-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60" />
        {/* Penalty area (top) */}
        <div className="absolute top-0 left-1/2 h-24 w-48 -translate-x-1/2 border-x-[2px] border-b-[2px] border-white/40 sm:h-32 sm:w-64" />
        {/* Penalty arc (top) */}
        <div className="absolute top-[6rem] left-1/2 h-10 w-20 -translate-x-1/2 rounded-b-full border-b-[2px] border-white/40 sm:top-[8rem] sm:h-12 sm:w-24" />
        {/* Penalty area (bottom) */}
        <div className="absolute bottom-0 left-1/2 h-24 w-48 -translate-x-1/2 border-x-[2px] border-t-[2px] border-white/40 sm:h-32 sm:w-64" />
        {/* Penalty arc (bottom) */}
        <div className="absolute bottom-[6rem] left-1/2 h-10 w-20 -translate-x-1/2 rounded-t-full border-t-[2px] border-white/40 sm:bottom-[8rem] sm:h-12 sm:w-24" />
      </div>

      {/* --- FOREGROUND CONTENT --- */}
      <div className="relative z-2 flex w-[90%] flex-col items-center text-center">
        {/* The Animated Red Card */}
        <div className="relative mb-6 animate-[slide-up_0.6s_ease-out] sm:mb-8">
          <div className="relative h-48 w-32 -rotate-12 transform rounded-sm border-2 border-red-500 bg-red-600 shadow-[0_0_30px_rgba(220,38,38,0.5)] transition-transform duration-500 hover:-translate-y-2 hover:scale-110 hover:rotate-0 sm:rounded-md lg:h-56 lg:w-40">
            {/* Subtle card texture */}
            <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent" />
          </div>
        </div>

        {/* Messaging */}
        <div className="mb-8 space-y-2">
          <h3 className="text-fluid-lg font-bold tracking-tighter uppercase italic">
            VAR Entscheidung: <span className="text-red-500">Rote Karte</span>
          </h3>
          <p className="text-fluid-sm whitespace-normal">
            Spielunterbrechung!
            <br />
            Ein unerwarteter Fehler is aufgetreten.
            <br />
            <i>(Digest: {error.digest})</i>
          </p>
        </div>

        <Button
          variant="danger"
          size="lg"
          className="text-fluid-lg h-[50px] w-full font-bold tracking-widest uppercase lg:h-[70px]"
          onPress={() => reset()}>
          Check VAR
        </Button>
      </div>
    </div>
  );
}
