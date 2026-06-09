"use client";

import { Button } from "@heroui/react";

export default function SoccerError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="relative flex flex-col items-center justify-center w-[95%] h-full my-6 overflow-hidden rounded-2xl">
      {/* --- BACKGROUND: Stylized Soccer Pitch (Pure CSS) --- */}
      <div className="absolute inset-0 pointer-events-none opacity-80">
        {/* Grass gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-green-600/50 to-[#0d542ba2]" />
        {/* Halfway line */}
        <div className="absolute top-1/2 left-0 w-full h-[2px] bg-white/40 -translate-y-1/2" />
        {/* Center circle */}
        <div className="absolute top-1/2 left-1/2 w-32 h-32 sm:w-48 sm:h-48 border-[2px] border-white/40 rounded-full -translate-x-1/2 -translate-y-1/2" />
        {/* Center spot */}
        <div className="absolute top-1/2 left-1/2 w-2 h-2 bg-white/60 rounded-full -translate-x-1/2 -translate-y-1/2" />
        {/* Penalty area (top) */}
        <div className="absolute top-0 left-1/2 w-48 sm:w-64 h-24 sm:h-32 border-b-[2px] border-x-[2px] border-white/40 -translate-x-1/2" />
        {/* Penalty arc (top) */}
        <div className="absolute top-[6rem] sm:top-[8rem] left-1/2 w-20 h-10 sm:w-24 sm:h-12 border-b-[2px] border-white/40 rounded-b-full -translate-x-1/2" />
        {/* Penalty area (bottom) */}
        <div className="absolute bottom-0 left-1/2 w-48 sm:w-64 h-24 sm:h-32 border-t-[2px] border-x-[2px] border-white/40 -translate-x-1/2" />
        {/* Penalty arc (bottom) */}
        <div className="absolute bottom-[6rem] sm:bottom-[8rem] left-1/2 w-20 h-10 sm:w-24 sm:h-12 border-t-[2px] border-white/40 rounded-t-full -translate-x-1/2" />
      </div>

      {/* --- FOREGROUND CONTENT --- */}
      <div className="relative z-2 flex flex-col items-center text-center w-[90%]">
        {/* The Animated Red Card */}
        <div className="relative mb-6 sm:mb-8 animate-[slide-up_0.6s_ease-out]">
          <div className="relative w-32 h-48 lg:w-40 lg:h-56 bg-red-600 rounded-sm sm:rounded-md border-2 border-red-500 shadow-[0_0_30px_rgba(220,38,38,0.5)] transform -rotate-12 transition-transform duration-500 hover:rotate-0 hover:scale-110 hover:-translate-y-2">
            {/* Subtle card texture */}
            <div className="absolute inset-0 bg-gradient-to-tr from-black/20 to-transparent" />
          </div>
        </div>

        {/* Messaging */}
        <div className="space-y-2 mb-8">
          <h3 className="text-fluid-lg tracking-tighter font-bold uppercase italic">
            VAR Entscheidung: <span className="text-red-500">Rote Karte</span>
          </h3>
          <p className="text-fluid-sm font-normal px-2 whitespace-normal">
            Ein unerwarteter Fehler ist aufgetreten, bitte versuchen Sie es erneut. <span className="italic">digest: {error.digest}</span>
          </p>
        </div>

        <Button
          variant="danger"
          size="lg"
          className="w-full font-bold uppercase tracking-widest text-fluid-lg h-[50px] lg:h-[70px]"
          onPress={() => reset()}>
          Check VAR
        </Button>
      </div>
    </div>
  );
}
