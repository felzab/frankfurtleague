export default function SoccerfieldBg({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex w-full flex-1 flex-col items-center px-2 py-4 sm:px-6 lg:px-8">
      <div className="soccer-field-base dotted-bg max-w-field relative w-full overflow-hidden rounded-2xl shadow-2xl sm:rounded-3xl">
        {/* Absolute Pitch Markings Layer (Non-interactive Background) */}
        <div className="pointer-events-none absolute inset-0 z-0">
          <div className="corner-arc-base corner-arc-tl" />
          <div className="corner-arc-base corner-arc-tr" />
          <div className="corner-arc-base corner-arc-bl" />
          <div className="corner-arc-base corner-arc-br" />
          <div className="penalty-area-base penalty-area-top" />
          <div className="penalty-area-base penalty-area-bottom" />
        </div>

        {/* Content Layer with generous vertical padding to completely clear the penalty boxes */}
        <div className="relative z-10 flex w-full flex-col items-center px-4 py-24 sm:px-8 sm:py-32 lg:px-16 lg:py-44">{children}</div>
      </div>
    </div>
  );
}
