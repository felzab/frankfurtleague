export function PageLoader() {
  return (
    // `role="status"` so the wait and its end are announced — nothing in the app was a live region,
    // so a screen-reader user heard silence through the whole navigation.
    <div
      role="status"
      className="flex min-h-[calc(100vh-var(--navbar-height))] w-full flex-1 flex-col items-center justify-center gap-y-4 px-4 py-12 text-center">
      <div className="relative flex items-center justify-center">
        {/* `motion-reduce:hidden`, not a dropped `animate-ping`: the keyframe declares only its end
            frames, so an unanimated halo rests as a full-size disc over the spinner rather than
            invisible. The spinner is the readout and keeps turning (ADR-0077). */}
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
