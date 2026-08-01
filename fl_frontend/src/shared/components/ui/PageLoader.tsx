export function PageLoader() {
  return (
    // `role="status"` so the wait and its end are announced — nothing in the app was a live region,
    // so a screen-reader user heard silence through the whole navigation.
    <div
      role="status"
      className="flex min-h-[calc(100vh-var(--navbar-height))] w-full flex-1 flex-col items-center justify-center gap-y-4 px-4 py-12 text-center">
      {/* Modern Spinner with Brand Accent */}
      <div className="relative flex items-center justify-center">
        {/* Outer glowing pulse ring */}
        <div className="bg-brand/20 absolute size-16 animate-ping rounded-full" />

        {/* Spinner ring */}
        <div className="border-border border-t-brand size-12 animate-spin rounded-full border-4" />
      </div>

      {/* Loading Text */}
      <div className="flex flex-col gap-y-1">
        <p className="text-fluid-base text-foreground font-extrabold tracking-wide uppercase">Laden...</p>
        <p className="text-fluid-xs text-foreground-muted font-medium">Daten werden vorbereitet</p>
      </div>
    </div>
  );
}
