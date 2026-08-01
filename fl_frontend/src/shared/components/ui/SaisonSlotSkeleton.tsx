/**
 * The placeholder that stands in for the sidemenu's season selector.
 *
 * Used twice, and both matter:
 * - as `Sidemenu`'s `Suspense` fallback, while `SaisonMetadataDisplay` fetches on the server;
 * - by `SaisonSelector` itself, until it has hydrated.
 *
 * The second is the non-obvious one. The selector streams in as real, styled markup well before
 * React attaches to it, so without this there is a window where the control looks completely ready
 * and does nothing at all when pressed. Keeping the placeholder until the selector is live means the
 * user only ever sees a control that works — and the transition is the one they were already
 * watching, not a new one.
 *
 * It carries no text, so it needs the labelled status region or a screen-reader user gets silence
 * while it waits.
 */
export function SaisonSlotSkeleton() {
  return (
    <div
      role="status"
      aria-label="Saisonauswahl wird geladen"
      className="bg-muted h-[70px] w-full animate-pulse rounded-xl"
    />
  );
}
