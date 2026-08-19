export function PageLoader() {
  return (
    // `role="status"` so the wait and its end are announced; without a live region a screen reader
    // hears silence through the whole navigation.
    <div
      role="status"
      className="flex min-h-[calc(100vh-var(--navbar-height))] w-full flex-1 flex-col items-center justify-center gap-y-4 px-4 py-12 text-center">
      <div className="relative flex items-center justify-center">
        {/* `motion-reduce:hidden` rather than a dropped animation: the keyframe declares only its end frames, so
            an unanimated halo rests as a full-size disc over the spinner. The spinner keeps turning. */}
        <div className="bg-brand/20 absolute size-16 animate-ping rounded-full motion-reduce:hidden" />

        <div className="border-border border-t-brand size-12 animate-spin rounded-full border-4" />
      </div>

      <div className="flex flex-col gap-y-1">
        <p className="fluid-base text-foreground font-extrabold tracking-wide uppercase">Laden...</p>
        <p className="fluid-xs text-foreground-muted font-medium">Daten werden vorbereitet</p>
      </div>
    </div>
  );
}
